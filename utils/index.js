const RLP = require("rlp");
const Web3 = require("web3");
const {TransactionFactory} = require("@ethereumjs/tx");
const {BaseTrie: Trie} = require("merkle-patricia-tree");
const {arrToBufArr} = require("ethereumjs-util");
const BN = Web3.utils.BN;

const createRLPHeader = block => {
    const fields = [
        block.parentHash,
        block.sha3Uncles,
        block.miner,
        block.stateRoot,
        block.transactionsRoot,
        block.receiptsRoot,
        block.logsBloom,
        BigInt(block.difficulty),
        BigInt(block.number),
        block.gasLimit,
        block.gasUsed,
        block.timestamp,
        block.extraData,
        block.mixHash,
        block.nonce,
    ];

    if (typeof block.baseFeePerGas !== "undefined") {
        fields.push(BigInt(block.baseFeePerGas));
    }

    return encodeToBuffer(fields);
};

const createRLPTransaction = (tx, chainId) => {
    const txData = {
        "nonce": tx.nonce,
        "gasLimit": new BN(tx.gas),
        "to": tx.to,
        "value": new BN(tx.value),
        "data": tx.input,
        "v": tx.v,
        "r": tx.r,
        "s": tx.s,
        "type": tx.type,
        "maxPriorityFeePerGas": new BN(tx.maxPriorityFeePerGas),
        "maxFeePerGas": new BN(tx.maxFeePerGas),
        chainId,
        "accessList": tx.accessList,
    };

    if (tx.type !== 2) {
        txData.gasPrice = new BN(tx.gasPrice);
    }

    return TransactionFactory.fromTxData(txData).serialize();
};

const createRLPReceipt = (receipt) => {
    const rlpEncoded = encodeToBuffer([
        receipt.status ? 1 : 0,  // convert boolean to binary
        receipt.cumulativeGasUsed,
        receipt.logsBloom,
        convertLogs(receipt.logs)
    ]);

    const type = Web3.utils.hexToNumber(receipt.type);
    if (type === 0) {
        return rlpEncoded;
    }

    return Buffer.concat([
        Buffer.from([type]),
        rlpEncoded,
    ]);
};

const newTrie = () => {
    return new Trie();
};

const asyncTriePut = (trie, key, value) => {
    return trie.put(key, value);
};

const asyncTrieGet = (trie, key) => {
    return trie.get(key);
};

const convertLogs = (logs) => {
    return logs.map(log =>
        [
            log.address,
            log.topics,
            log.data,
        ]
    );
};

const encodeToBuffer = (input) => {
    return arrToBufArr(RLP.encode(input));
};

module.exports = {
    createRLPHeader,
    createRLPTransaction,
    createRLPReceipt,
    newTrie,
    asyncTriePut,
    asyncTrieGet,
    encodeToBuffer,
};
