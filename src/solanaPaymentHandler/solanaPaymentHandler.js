// solanaPaymentHandler.js

const {
    Connection,
    PublicKey,
    Keypair,
    SystemProgram,
    Transaction
  } = require('@solana/web3.js');
  
  const { v4: uuidv4 } = require('uuid');
  const logger = require('../utils/logger');
  const database = require('../database/database'); // module de DB
  require('dotenv').config(); // s'il n'est pas déjà appelé ailleurs
  
  class SolanaPaymentHandler {
    constructor(heliusUrl) {
      if (!heliusUrl) {
        throw new Error('HELIUS_RPC_URL is not set');
      }
      this.connection = new Connection(heliusUrl, 'confirmed');
      
      // sessions : { sessionId -> paymentData }
      this.sessions = new Map();
  
      this.prices = {
        '1month': 0.5,
        '3month': 1.2,
        '6month': 2.0
      };
      // Durée de validité (ex: 30 minutes)
      this.sessionValidityMs = 30 * 60 * 1000;
  
      // Adresse principale (wallet où rapatrier les fonds)
      this.mainWalletAddress = process.env.MAIN_WALLET_ADDRESS;
      if (!this.mainWalletAddress) {
        logger.warn('MAIN_WALLET_ADDRESS not set. transferFunds() will fail if called.');
      }
    }
  
    /**
     * Crée une nouvelle session de paiement et l'enregistre en base.
     * Si la sauvegarde en base échoue, on annule la création (rollback).
     */
    async createPaymentSession(username, duration) {
      const sessionId = uuidv4();
      const amount = this.prices[duration];
      if (!amount) {
        throw new Error(`Invalid duration "${duration}". Expected one of: 1month, 3month, 6month`);
      }
  
      const paymentKeypair = Keypair.generate();
      const base64Key = Buffer.from(paymentKeypair.secretKey).toString('base64');
  
      const paymentData = {
        sessionId,
        username,
        duration,
        amount,
        paymentAddress: paymentKeypair.publicKey.toString(),
        privateKey: base64Key,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + this.sessionValidityMs),
        paid: false
      };
  
      // Essayer d'insérer en base
      try {
        // 1) Insère en DB
        await database.savePaymentAddress(paymentData);
  
        // 2) Si ok, on stocke en mémoire
        this.sessions.set(sessionId, paymentData);
  
        logger.info(
          `Created payment session ${sessionId} for user "${username}" (duration: ${duration}, amount: ${amount} SOL)`
        );
  
        // Renvoie les infos nécessaires
        return {
          sessionId,
          paymentAddress: paymentData.paymentAddress,
          amount,
          duration,
          expires: paymentData.expiresAt
        };
  
      } catch (err) {
        logger.error(`Failed to save payment address (session ${sessionId}) in DB:`, err);
        // On choisit d'annuler la session en mémoire (rollback),
        // pour éviter d'avoir des sessions "fantôme".
        // (Si tu veux la garder quand même, tu peux ne pas faire ça.)
        // this.sessions.delete(sessionId);
  
        throw new Error(`Could not create payment session: ${err.message}`);
      }
    }
  
    /**
     * Récupère les infos d'une session en mémoire.
     */
    getPaymentSession(sessionId) {
      return this.sessions.get(sessionId) || null;
    }
  
    /**
     * Vérifie si le paiement est arrivé sur l'adresse Solana.
     * S'il est arrivé, on marque session.paid = true en mémoire
     * (et éventuellement on met à jour en DB si besoin).
     */
    async checkPayment(sessionId) {
      const session = this.getPaymentSession(sessionId);
      if (!session) {
        return { success: false, reason: 'Session not found.' };
      }
  
      if (Date.now() > session.expiresAt.getTime()) {
        return { success: false, reason: 'Session expired.' };
      }
  
      if (session.paid) {
        return { success: true, alreadyPaid: true };
      }
  
      try {
        const balanceLamports = await this.connection.getBalance(
          new PublicKey(session.paymentAddress)
        );
        const balanceSol = balanceLamports / 1e9;
  
        logger.info(
          `Balance of address ${session.paymentAddress}: ` +
          `${balanceSol} SOL (expected: ${session.amount})`
        );
  
        if (balanceSol >= session.amount) {
          session.paid = true;
          this.sessions.set(sessionId, session);
  
          // Optionnel : marquer en DB que c'est payé, ex:
          // await database.updatePaymentAddressStatus(sessionId, 'paid');
  
          return { success: true };
        } else {
          return { success: false, reason: 'Payment not detected yet' };
        }
      } catch (error) {
        logger.error(`Error checking payment for session ${sessionId}:`, error);
        return { success: false, reason: 'Error checking Solana balance' };
      }
    }
  
    /**
     * Rapatrie tous les fonds de l'adresse de la session vers MAIN_WALLET_ADDRESS.
     * - Nécessite que la session soit paid = true (ou tout du moins qu'il y ait un solde).
     * - Utilise la privateKey stockée pour signer la transaction.
     */
    async transferFunds(sessionId) {
        const session = this.getPaymentSession(sessionId);
        if (!session?.paid) {
          throw new Error('Session not found or not paid.');
        }
        if (!this.mainWalletAddress) {
          throw new Error('MAIN_WALLET_ADDRESS not configured.');
        }
      
        const rawPrivateKey = Buffer.from(session.privateKey, 'base64');
        const keypair = Keypair.fromSecretKey(rawPrivateKey);
      
        // Lire le solde
        const lamports = await this.connection.getBalance(keypair.publicKey);
        if (lamports === 0) {
          throw new Error('No funds to transfer (balance=0).');
        }
      
        // On crée une instruction fictive (on mettra le montant complet pour l’instant).
        const instruction = SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: new PublicKey(this.mainWalletAddress),
          lamports // on met tout
        });
      
        let transaction = new Transaction().add(instruction);
      
        // Récupérer le blockhash
        const latestBlockhash = await this.connection.getLatestBlockhash();
        transaction.recentBlockhash = latestBlockhash.blockhash;
        transaction.feePayer = keypair.publicKey;
      
        // On "compile" la transaction en un message (sans signer)
        const messageBytes = transaction.compileMessage(); // old style
        // OU transaction.compileMessage({ verifySignatures: false })
        const feeResult = await this.connection.getFeeForMessage(messageBytes, 'confirmed');
      
        if (feeResult.value === null) {
          throw new Error('Unable to calculate transaction fee.');
        }
        const requiredFee = feeResult.value; // lamports
      
        // S’il n’y a pas assez pour le fee
        if (lamports <= requiredFee) {
          throw new Error(
            `Not enough balance to cover fee. Balance=${lamports}, fee=${requiredFee}`
          );
        }
        // On veut envoyer (lamports - requiredFee)
        const lamportsToSend = lamports - requiredFee;
      
        // Reconstruire l'instruction finale
        const finalInstruction = SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: new PublicKey(this.mainWalletAddress),
          lamports: lamportsToSend
        });
        transaction = new Transaction().add(finalInstruction);
        transaction.recentBlockhash = latestBlockhash.blockhash;
        transaction.feePayer = keypair.publicKey;
      
        // Maintenant on signe et on envoie
        const signature = await this.connection.sendTransaction(transaction, [keypair]);
        await this.connection.confirmTransaction(
          {
            signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
          },
          'confirmed'
        );
      
        return signature;
      }      
  }
  
  module.exports = SolanaPaymentHandler;
  