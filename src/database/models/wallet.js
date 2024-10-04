// models/wallet.js

class Wallet {
    constructor(address, data) {
        this.address = address;
        this.data = data;
        this.lastUpdated = new Date();
    }

    static fromDocument(doc) {
        const wallet = new Wallet(doc.address, doc.data);
        wallet.lastUpdated = doc.lastUpdated;
        return wallet;
    }

    toDocument() {
        return {
            address: this.address,
            data: this.data,
            lastUpdated: this.lastUpdated
        };
    }
}

module.exports = Wallet;