const RLP = require('rlp');
const Web3 = require('web3');
const {Transaction} = require('ethereumjs-tx');
const {BaseTrie: Trie} = require('merkle-patricia-tree');
const {bufArrToArr} = require('ethereumjs-util');

const web3 = new Web3(Web3.givenProvider || 'https://mainnet.infura.io', null, {});
const BN = web3.utils.BN;

const createRLPHeader = (block) => {
    return RLP.encode([
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
    ]);
};
const createRLPHeaderWithoutNonce = (block) => {
    return RLP.encode([
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
    ]);
};

const createRLPTransaction = (tx, chainId) => {
    const txData = {
      nonce: tx.nonce,
      gasPrice: web3.utils.toHex(new BN(tx.gasPrice)),
      gasLimit: tx.gas,
      to: tx.to,
      value: web3.utils.toHex(new BN(tx.value)),
      data: tx.input,
      v: tx.v,
      r: tx.r,
      s: tx.s
    };
    const transaction = new Transaction(txData, { chain: chainId });
    return transaction.serialize();
};

const createRLPReceipt = (receipt) => {
    return RLP.encode([
        receipt.status ? 1 : 0,  // convert boolean to binary
        receipt.cumulativeGasUsed,
        receipt.logsBloom,
        convertLogs(receipt.logs)
    ]);
};

const newTrie = () => {
    return new Trie();
};

const asyncTriePut = (trie, key, value) => {
    return trie.put(key, value);
};

const asyncTrieProve = async (trie, key) => {
    const proof = await Trie.createProof(trie, key);
    return bufArrToArr(proof);
};

const asyncTrieGet = (trie, key) => {
    return trie.get(key);
};

const convertLogs = (logs) => {
    const convertedLogs = [];
    for (const log of logs) {
        convertedLogs.push([
            log.address,
            log.topics,
            log.data
        ]);
    }
    return convertedLogs;
};

module.exports = {
    // calculateBlockHash,
    createRLPHeader,
    createRLPHeaderWithoutNonce,
    createRLPTransaction,
    createRLPReceipt,
    newTrie,
    asyncTriePut,
    asyncTrieGet,
    asyncTrieProve
    // addToHex
};
