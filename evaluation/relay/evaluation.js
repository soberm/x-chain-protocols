const {
    asyncTriePut,
    newTrie,
    createRLPHeader,
    createRLPTransaction,
    createRLPReceipt
} = require('../../utils');
const RLP = require('rlp');
const fs = require('fs');
const {
    initNetwork,
    callContract,
    sleep,
    getMostRecentBlockHash,
    getHeaderInfo,
    isHeaderStored
} = require('../common');
const config = require('./config');  // conten of config.json

const RUNS = 300;

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
    fs.writeSync(fd, "run,burn_gas,claim_gas,confirm_gas,burn_cost,claim_cost,confirm_cost,burn_incTime,claim_incTime,confirm_incTime,burn_confTime,claim_confTime,confirm_confTime,burn_confTimeRelay,claim_confTimeRelay\n");

    for (let run = 1; run <= RUNS; run++) {
        let result = {
            burn: {},
            claim: {},
            confirm: {}
        };
        console.log('Run:', run);

        // submit burn transaction
        let balanceInWeiBefore = parseInt(await rinkebyNetworkInstance.web3.eth.getBalance(config.rinkeby.accounts.user.address));
        let startTime = new Date().getTime();
        let burnReceipt;
        try {
            burnReceipt = await burn(config.rinkeby, rinkebyNetworkInstance, config.ropsten.accounts.user.address, config.ropsten.contracts.protocol.address, 1, 0);
        } catch (e) {
            console.log(e.message);
            run--;
            continue;
        }
        let endTime = new Date().getTime();
        let balanceInWeiAfter = parseInt(await rinkebyNetworkInstance.web3.eth.getBalance(config.rinkeby.accounts.user.address));
        result.burn.inclusionTime = (endTime - startTime) / 1000;  // diff in seconds
        result.burn.gasConsumption = burnReceipt.gasUsed;
        result.burn.cost = balanceInWeiBefore - balanceInWeiAfter;

        console.log('wait for confirmation of burn tx ...');
        startTime = new Date().getTime();
        await waitUntilConfirmed(rinkebyNetworkInstance.web3, burnReceipt.transactionHash, config.rinkeby.confirmations);
        endTime = new Date().getTime();
        result.burn.confirmationTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log('burn tx is confirmed');

        console.log('wait for burn tx to be confirmed within relay running on Ropsten ...');
        startTime = new Date().getTime();
        await waitUntilConfirmedWithinRelay(rinkebyNetworkInstance.web3, burnReceipt.transactionHash, config.rinkeby.confirmations, ropstenNetworkInstance.contracts.txVerifier);
        endTime = new Date().getTime();
        result.burn.relayTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log('burn tx is confirmed within relay');


        // submit claim transaction
        burnReceipt = await rinkebyNetworkInstance.web3.eth.getTransactionReceipt(burnReceipt.transactionHash);  // load receipt again to be on the safe side if chain reorganization occurred
        let block = await rinkebyNetworkInstance.web3.eth.getBlock(burnReceipt.blockHash);
        let tx = await rinkebyNetworkInstance.web3.eth.getTransaction(burnReceipt.transactionHash);
        let txReceipt = await rinkebyNetworkInstance.web3.eth.getTransactionReceipt(burnReceipt.transactionHash);
        let rlpHeader = createRLPHeader(block);
        let rlpEncodedTx = createRLPTransaction(tx, config.rinkeby.chainId);
        let rlpEncodedReceipt = createRLPReceipt(txReceipt);
        let path = RLP.encode(tx.transactionIndex);
        let rlpEncodedTxNodes = await createTxMerkleProof(rinkebyNetworkInstance.web3, config.rinkeby.chainId, block, tx.transactionIndex);
        let rlpEncodedReceiptNodes = await createReceiptMerkleProof(rinkebyNetworkInstance.web3, block, tx.transactionIndex);

        balanceInWeiBefore = parseInt(await ropstenNetworkInstance.web3.eth.getBalance(config.ropsten.accounts.user.address));
        startTime = new Date().getTime();
        let claimReceipt;
        try{
            claimReceipt = await claim(config.ropsten, ropstenNetworkInstance, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path);
        } catch (e) {
            console.log(e.message);
            run--;
            continue;
        }
        endTime = new Date().getTime();
        balanceInWeiAfter = parseInt(await ropstenNetworkInstance.web3.eth.getBalance(config.ropsten.accounts.user.address));
        result.claim.inclusionTime = (endTime - startTime) / 1000;  // diff in seconds
        result.claim.gasConsumption = claimReceipt.gasUsed;
        result.claim.cost = balanceInWeiBefore - balanceInWeiAfter;

        console.log('wait for confirmation of claim tx ...');
        startTime = new Date().getTime();
        await waitUntilConfirmed(ropstenNetworkInstance.web3, claimReceipt.transactionHash, config.ropsten.confirmations);
        endTime = new Date().getTime();
        result.claim.confirmationTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log('claim tx is confirmed');

        console.log('wait for claim tx to be confirmed within relay running on Rinkeby ...');
        startTime = new Date().getTime();
        await waitUntilConfirmedWithinRelay(ropstenNetworkInstance.web3, claimReceipt.transactionHash, config.ropsten.confirmations, rinkebyNetworkInstance.contracts.txVerifier);
        endTime = new Date().getTime();
        result.claim.relayTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log('claim tx is confirmed within relay');


        // submit confirm transaction
        claimReceipt = await ropstenNetworkInstance.web3.eth.getTransactionReceipt(claimReceipt.transactionHash);  // load receipt again to be on the safe side if chain reorganization occurred
        block = await ropstenNetworkInstance.web3.eth.getBlock(claimReceipt.blockHash);
        tx = await ropstenNetworkInstance.web3.eth.getTransaction(claimReceipt.transactionHash);
        txReceipt = await ropstenNetworkInstance.web3.eth.getTransactionReceipt(claimReceipt.transactionHash);
        rlpHeader = createRLPHeader(block);
        rlpEncodedTx = createRLPTransaction(tx, config.ropsten.chainId);
        rlpEncodedReceipt = createRLPReceipt(txReceipt);
        path = RLP.encode(tx.transactionIndex);
        rlpEncodedTxNodes = await createTxMerkleProof(ropstenNetworkInstance.web3, config.ropsten.chainId, block, tx.transactionIndex);
        rlpEncodedReceiptNodes = await createReceiptMerkleProof(ropstenNetworkInstance.web3, block, tx.transactionIndex);

        balanceInWeiBefore = parseInt(await rinkebyNetworkInstance.web3.eth.getBalance(config.rinkeby.accounts.user.address));
        startTime = new Date().getTime();
        let confirmReceipt;
        try {
            confirmReceipt = await confirm(config.rinkeby, rinkebyNetworkInstance, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path);
        } catch (e) {
            console.log(e.message);
            run--;
            continue;
        }
        endTime = new Date().getTime();
        balanceInWeiAfter = parseInt(await rinkebyNetworkInstance.web3.eth.getBalance(config.rinkeby.accounts.user.address));
        result.confirm.inclusionTime = (endTime - startTime) / 1000;  // diff in seconds
        result.confirm.gasConsumption = confirmReceipt.gasUsed;
        result.confirm.cost = balanceInWeiBefore - balanceInWeiAfter;

        console.log('wait for confirmation of confirm tx ...');
        startTime = new Date().getTime();
        await waitUntilConfirmed(rinkebyNetworkInstance.web3, confirmReceipt.transactionHash, config.rinkeby.confirmations);
        endTime = new Date().getTime();
        result.confirm.confirmationTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log('confirm tx is confirmed');

        console.log(`${run}: ${result.burn.gasConsumption},${result.claim.gasConsumption},${result.confirm.gasConsumption},${result.burn.cost},${result.claim.cost},${result.confirm.cost},${result.burn.inclusionTime},${result.claim.inclusionTime},${result.confirm.inclusionTime},${result.burn.confirmationTime},${result.claim.confirmationTime},${result.confirm.confirmationTime},${result.burn.relayTime},${result.claim.relayTime}`);
        fs.writeSync(fd, `${run},${result.burn.gasConsumption},${result.claim.gasConsumption},${result.confirm.gasConsumption},${result.burn.cost},${result.claim.cost},${result.confirm.cost},${result.burn.inclusionTime},${result.claim.inclusionTime},${result.confirm.inclusionTime},${result.burn.confirmationTime},${result.claim.confirmationTime},${result.confirm.confirmationTime},${result.burn.relayTime},${result.claim.relayTime}\n`);
    }

    fs.closeSync(fd);
    console.log(`+++ Done +++`);
}

async function burn(networkConfig, networkInstance, recipientAddr, claimContractAddr, value, stake) {
    return await callContract(
        networkConfig,
        networkConfig.accounts.user,
        networkInstance.web3,
        networkConfig.contracts.protocol.address,
        networkInstance.contracts.protocol.instance.methods.burn(recipientAddr, claimContractAddr, value, stake)
    );
}

async function claim(networkConfig, networkInstance, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path) {
    return await callContract(
        networkConfig,
        networkConfig.accounts.user,
        networkInstance.web3,
        networkConfig.contracts.protocol.address,
        networkInstance.contracts.protocol.instance.methods.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path)
    );
}

async function confirm(networkConfig, networkInstance, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path) {
    return await callContract(
        networkConfig,
        networkConfig.accounts.user,
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
        await sleep(1500);
    }
}

/**
 * Waits until the header of block with blockHash is stored and confirmed within the relay.
 * @param blockNumber
 * @param confirmations
 * @param networkInstance
 * @returns {Promise<void>}
 */
async function waitUntilConfirmedWithinRelay(sourceWeb3, transactionHash, confirmations, relayContract) {
    let firstRun = true;
    let headerToConfirm;
    let headerToConfirmBlockNr;
    let mostRecentBlockHash;
    let mostRecentHeader;
    let isConfirmed = false;

    do {
        if (firstRun === false) {  // do not sleep at first run
            await sleep(1500);
        }
        firstRun = false;

        let receipt = await sourceWeb3.eth.getTransactionReceipt(transactionHash);

        if (receipt === null) {
            continue;
        }

        headerToConfirm = await getHeaderInfo(relayContract, receipt.blockHash);
        headerToConfirmBlockNr = parseInt(headerToConfirm.blockNumber);
        console.log('HeaderToConfirm:',headerToConfirmBlockNr);
        if (headerToConfirmBlockNr === 0) {
            // header to confirm not stored within relay -> wait
            continue;
        }

        mostRecentBlockHash = await getMostRecentBlockHash(relayContract);
        mostRecentHeader = await getHeaderInfo(relayContract, mostRecentBlockHash);
        console.log('MostRecentHeader:',parseInt(mostRecentHeader.blockNumber));
        if ((headerToConfirmBlockNr + confirmations) <= parseInt(mostRecentHeader.blockNumber)) {
            // check if most recent block header can reach headerToConfirm by traversing over parent hashes
            let currentHeader = mostRecentHeader;
            while (headerToConfirmBlockNr <= parseInt(currentHeader.blockNumber)) {
                if (currentHeader.hash.localeCompare(headerToConfirm.hash) === 0) {
                    isConfirmed = true;
                    break;
                }
                let parentHash = (await sourceWeb3.eth.getBlock(currentHeader.hash)).parentHash;
                currentHeader = await getHeaderInfo(relayContract, parentHash);
            }
        }
    } while (isConfirmed === false);
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
    return RLP.encode(await Trie.createProof(trie, key));
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
    return RLP.encode(await Trie.createProof(trie, key));
};