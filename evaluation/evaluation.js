const {
    asyncTrieProve,
    asyncTriePut,
    newTrie,
    createRLPHeader,
    createRLPTransaction,
    createRLPReceipt
} = require('../utils');
const RLP = require('rlp');
const fs = require('fs');
const { initNetwork, callContract, sleep } = require('./common');
const config = require('./config');  // conten of config.json


module.exports = async function (callback) {
    try {
        let rinkebyNetworkInstance = initNetwork(config.rinkeby);
        let ropstenNetworkInstance = initNetwork(config.ropsten);
        await startEvaluation(rinkebyNetworkInstance, ropstenNetworkInstance);
        callback();
    } catch (err) {
        callback(err);
    }
};

async function startEvaluation(rinkebyNetworkInstance, ropstenNetworkInstance) {
    console.log(`+++ Starting evaluation +++`);

    const fd = fs.openSync(`./evaluation/results.csv`, "w");
    fs.writeSync(fd, "run,burn_gas,claim_gas,confirm_gas,burn_incTime,burn_confTime,claim_incTime,claim_confTime,confirm_incTime,confirm_confTime\n");

    for (let run = 1; run <= 1; run++) {
        let result = {
            burn: {},
            claim: {},
            confirm: {}
        };
        console.log('Run:', run);

        // submit burn transaction
        let startTime = new Date().getTime();
        const burnReceipt = await burn(config.rinkeby, rinkebyNetworkInstance, config.ropsten.account.address, config.ropsten.contracts.protocol.address, 1, 0);
        let endTime = new Date().getTime();
        result.burn.inclusionTime = (endTime - startTime) / 1000;  // diff in seconds

        console.log('wait for confirmation of burn tx ...');
        startTime = new Date().getTime();
        await waitUntilConfirmed(rinkebyNetworkInstance.web3, burnReceipt.transactionHash, config.rinkeby.confirmations);
        endTime = new Date().getTime();
        result.burn.confirmationTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log('burn tx is confirmed');
        result.burn.gasConsumption = burnReceipt.gasUsed;


        // submit claim transaction
        let block = await rinkebyNetworkInstance.web3.eth.getBlock(burnReceipt.blockHash);
        let tx = await rinkebyNetworkInstance.web3.eth.getTransaction(burnReceipt.transactionHash);
        let txReceipt = await rinkebyNetworkInstance.web3.eth.getTransactionReceipt(burnReceipt.transactionHash);
        let rlpHeader = createRLPHeader(block);
        let rlpEncodedTx = createRLPTransaction(tx, config.rinkeby.chainId);
        let rlpEncodedReceipt = createRLPReceipt(txReceipt);
        let path = RLP.encode(tx.transactionIndex);
        let rlpEncodedTxNodes = await createTxMerkleProof(rinkebyNetworkInstance.web3, config.rinkeby.chainId, block, tx.transactionIndex);
        let rlpEncodedReceiptNodes = await createReceiptMerkleProof(rinkebyNetworkInstance.web3, block, tx.transactionIndex);

        startTime = new Date().getTime();
        const claimReceipt = await claim(config.ropsten, ropstenNetworkInstance, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path);
        endTime = new Date().getTime();
        result.claim.inclusionTime = (endTime - startTime) / 1000;  // diff in seconds

        console.log('wait for confirmation of claim tx ...');
        startTime = new Date().getTime();
        await waitUntilConfirmed(ropstenNetworkInstance.web3, claimReceipt.transactionHash, config.ropsten.confirmations);
        endTime = new Date().getTime();
        result.claim.confirmationTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log('claim tx is confirmed');
        result.claim.gasConsumption = claimReceipt.gasUsed;


        // submit confirm transaction
        block = await ropstenNetworkInstance.web3.eth.getBlock(claimReceipt.blockHash);
        tx = await ropstenNetworkInstance.web3.eth.getTransaction(claimReceipt.transactionHash);
        txReceipt = await ropstenNetworkInstance.web3.eth.getTransactionReceipt(claimReceipt.transactionHash);
        rlpHeader = createRLPHeader(block);
        rlpEncodedTx = createRLPTransaction(tx, config.ropsten.chainId);
        rlpEncodedReceipt = createRLPReceipt(txReceipt);
        path = RLP.encode(tx.transactionIndex);
        rlpEncodedTxNodes = await createTxMerkleProof(ropstenNetworkInstance.web3, config.ropsten.chainId, block, tx.transactionIndex);
        rlpEncodedReceiptNodes = await createReceiptMerkleProof(ropstenNetworkInstance.web3, block, tx.transactionIndex);

        startTime = new Date().getTime();
        const confirmReceipt = await confirm(config.rinkeby, rinkebyNetworkInstance, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path);
        endTime = new Date().getTime();
        result.confirm.inclusionTime = (endTime - startTime) / 1000;  // diff in seconds

        console.log('wait for confirmation of confirm tx ...');
        startTime = new Date().getTime();
        await waitUntilConfirmed(rinkebyNetworkInstance.web3, confirmReceipt.transactionHash, config.rinkeby.confirmations);
        endTime = new Date().getTime();
        result.confirm.confirmationTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log('confirm tx is confirmed');
        result.confirm.gasConsumption = confirmReceipt.gasUsed;

        console.log(`${run}: ${result.burn.gasConsumption},${result.claim.gasConsumption},${result.confirm.gasConsumption},${result.burn.inclusionTime},${result.burn.confirmationTime},${result.claim.inclusionTime},${result.claim.confirmationTime},${result.confirm.inclusionTime},${result.confirm.confirmationTime}`);
        fs.writeSync(fd, `${run},${result.burn.gasConsumption},${result.claim.gasConsumption},${result.confirm.gasConsumption},${result.burn.inclusionTime},${result.burn.confirmationTime},${result.claim.inclusionTime},${result.claim.confirmationTime},${result.confirm.inclusionTime},${result.confirm.confirmationTime}\n`);
    }

    fs.closeSync(fd);
    console.log(`+++ Done +++`);
}

async function burn(networkConfig, networkInstance, recipientAddr, claimContractAddr, value, stake) {
    return await callContract(
        networkConfig,
        networkInstance.web3,
        networkConfig.contracts.protocol.address,
        networkInstance.contracts.protocol.instance.methods.burn(recipientAddr, claimContractAddr, value, stake)
    );
}

async function claim(networkConfig, networkInstance, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path) {
    return await callContract(
        networkConfig,
        networkInstance.web3,
        networkConfig.contracts.protocol.address,
        networkInstance.contracts.protocol.instance.methods.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path)
    );
}

async function confirm(networkConfig, networkInstance, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path) {
    return await callContract(
        networkConfig,
        networkInstance.web3,
        networkConfig.contracts.protocol.address,
        networkInstance.contracts.protocol.instance.methods.confirm(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path)
    );
}

async function waitUntilConfirmed(web3, txHash, confirmations) {
    while (true) {
        let receipt = await web3.eth.getTransactionReceipt(txHash);
        if (receipt !== null) {
            let mostRecentBlockNumber = await web3.eth.getBlockNumber();
            if (receipt.blockNumber + confirmations <= mostRecentBlockNumber) {
                // receipt != null -> tx is part of main chain
                // and block containing tx has at least confirmations successors
                break;
            }
        }
        sleep(1500);
    }
}

const createTxMerkleProof = async (web3, chainId, block, transactionIndex) => {
    const trie = newTrie();

    for (let i = 0; i < block.transactions.length; i++) {
        const tx = await web3.eth.getTransaction(block.transactions[i]);
        const rlpTx = createRLPTransaction(tx, chainId);
        const key = RLP.encode(i);
        await asyncTriePut(trie, key, rlpTx);
    }

    const key = RLP.encode(transactionIndex);
    return RLP.encode(await asyncTrieProve(trie, key));
};

const createReceiptMerkleProof = async (web3, block, transactionIndex) => {
    const trie = newTrie();

    for (let i = 0; i < block.transactions.length; i++) {
        const receipt = await web3.eth.getTransactionReceipt(block.transactions[i]);
        const rlpReceipt = createRLPReceipt(receipt);
        const key = RLP.encode(i);
        await asyncTriePut(trie, key, rlpReceipt);
    }

    const key = RLP.encode(transactionIndex);
    return RLP.encode(await asyncTrieProve(trie, key));
};