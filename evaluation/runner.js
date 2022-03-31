const {
    asyncTriePut,
    newTrie,
    createRLPHeader,
    createRLPTransaction,
    createRLPReceipt,
    encodeToBuffer,
} = require("../utils");
const fs = require("fs");
const {BaseTrie: Trie} = require("merkle-patricia-tree");
const {burn, claim, confirm} = require("./common");
const initNetwork = require("./network");
const path = require("path");

const RUNS = 100;

module.exports = async function(dirname, waitUntilVerified) {

    const config = require(path.resolve(dirname, "config"));

    console.log("+++ Starting evaluation +++");

    const fd = fs.openSync(path.resolve(dirname, "results.csv"), "w");
    fs.writeSync(fd, "run,burn_gas,claim_gas,confirm_gas,burn_cost,claim_cost,confirm_cost,burn_incTime,claim_incTime,confirm_incTime,burn_confTime,claim_confTime,confirm_confTime,burn_confTimeRelay,claim_confTimeRelay\n");

    for (let run = 1; run <= RUNS; run++) {

        console.log("Run:", run);

        const result = {
            burn: {},
            claim: {},
            confirm: {}
        };

        const [network0, network1] = [initNetwork(config[0]), initNetwork(config[1])];

        let balanceInWeiBefore = BigInt(await network0.web3.eth.getBalance(network0.accounts.user.address));
        let startTime = new Date().getTime();
        const burnPromises = await burn(network0, network1);
        let burnReceipt;
        try {
            burnReceipt = await burnPromises.inclusion;
        } catch (e) {
            console.log(e.message);
            run--;
            continue;
        }
        let endTime = new Date().getTime();
        let balanceInWeiAfter = BigInt(await network0.web3.eth.getBalance(network0.accounts.user.address));
        result.burn.inclusionTime = (endTime - startTime) / 1000;  // diff in seconds
        result.burn.gasConsumption = burnReceipt.gasUsed;
        result.burn.cost = balanceInWeiBefore - balanceInWeiAfter;

        console.log("wait for confirmation of burn tx ...");
        startTime = new Date().getTime();
        await burnPromises.confirmation;
        endTime = new Date().getTime();
        result.burn.confirmationTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log("burn tx is confirmed");

        console.log("wait for burn tx to be confirmed within relay running on Ropsten ...");
        startTime = new Date().getTime();
        
        await waitUntilVerified({
            "source": network0,
            "destination": network1,
            "receipt": burnReceipt,
        });
        endTime = new Date().getTime();
        result.burn.relayTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log("burn tx is confirmed within relay");


        // submit claim transaction
        burnReceipt = await network0.web3.eth.getTransactionReceipt(burnReceipt.transactionHash);  // load receipt again to be on the safe side if chain reorganization occurred
        let block = await network0.web3.eth.getBlock(burnReceipt.blockHash);
        let tx = await network0.web3.eth.getTransaction(burnReceipt.transactionHash);
        let txReceipt = await network0.web3.eth.getTransactionReceipt(burnReceipt.transactionHash);
        let rlpHeader = createRLPHeader(block);
        let rlpEncodedTx = createRLPTransaction(tx, network0.chainId);
        let rlpEncodedReceipt = createRLPReceipt(txReceipt);
        let path = encodeToBuffer(tx.transactionIndex);
        let rlpEncodedTxNodes = await createTxMerkleProof(network0.web3, network0.chainId, block, tx.transactionIndex);
        let rlpEncodedReceiptNodes = await createReceiptMerkleProof(network0.web3, block, tx.transactionIndex);

        balanceInWeiBefore = BigInt(await network1.web3.eth.getBalance(network1.accounts.user.address));
        startTime = new Date().getTime();
        const claimPromises = await claim(network1, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path);
        let claimReceipt;
        try{
            claimReceipt = await claimPromises.inclusion;
        } catch (e) {
            console.log(e.message);
            run--;
            continue;
        }
        endTime = new Date().getTime();
        balanceInWeiAfter = BigInt(await network1.web3.eth.getBalance(network1.accounts.user.address));
        result.claim.inclusionTime = (endTime - startTime) / 1000;  // diff in seconds
        result.claim.gasConsumption = claimReceipt.gasUsed;
        result.claim.cost = balanceInWeiBefore - balanceInWeiAfter;

        console.log("wait for confirmation of claim tx ...");
        startTime = new Date().getTime();
        await claimPromises.confirmation;
        endTime = new Date().getTime();
        result.claim.confirmationTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log("claim tx is confirmed");

        console.log("wait for claim tx to be confirmed within relay running on Rinkeby ...");
        startTime = new Date().getTime();
        await waitUntilVerified({
            "source": network1,
            "destination": network0,
            "receipt": claimReceipt,
        });
        endTime = new Date().getTime();
        result.claim.relayTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log("claim tx is confirmed within relay");


        // submit confirm transaction
        claimReceipt = await network1.web3.eth.getTransactionReceipt(claimReceipt.transactionHash);  // load receipt again to be on the safe side if chain reorganization occurred
        block = await network1.web3.eth.getBlock(claimReceipt.blockHash);
        tx = await network1.web3.eth.getTransaction(claimReceipt.transactionHash);
        txReceipt = await network1.web3.eth.getTransactionReceipt(claimReceipt.transactionHash);
        rlpHeader = createRLPHeader(block);
        rlpEncodedTx = createRLPTransaction(tx, network1.chainId);
        rlpEncodedReceipt = createRLPReceipt(txReceipt);
        path = encodeToBuffer(tx.transactionIndex);
        rlpEncodedTxNodes = await createTxMerkleProof(network1.web3, network1.chainId, block, tx.transactionIndex);
        rlpEncodedReceiptNodes = await createReceiptMerkleProof(network1.web3, block, tx.transactionIndex);

        balanceInWeiBefore = BigInt(await network0.web3.eth.getBalance(network0.accounts.user.address));
        startTime = new Date().getTime();
        const confirmPromises = await confirm(network0, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path);
        let confirmReceipt;
        try {
            confirmReceipt = await confirmPromises.inclusion;
        } catch (err) {
            console.log(err);
            run--;
            continue;
        }
        endTime = new Date().getTime();
        balanceInWeiAfter = BigInt(await network0.web3.eth.getBalance(network0.accounts.user.address));
        result.confirm.inclusionTime = (endTime - startTime) / 1000;  // diff in seconds
        result.confirm.gasConsumption = confirmReceipt.gasUsed;
        result.confirm.cost = balanceInWeiBefore - balanceInWeiAfter;

        console.log("wait for confirmation of confirm tx ...");
        startTime = new Date().getTime();
        await confirmPromises.confirmation;
        endTime = new Date().getTime();
        result.confirm.confirmationTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log("confirm tx is confirmed");

        console.log(`${run}: ${result.burn.gasConsumption},${result.claim.gasConsumption},${result.confirm.gasConsumption},${result.burn.cost},${result.claim.cost},${result.confirm.cost},${result.burn.inclusionTime},${result.claim.inclusionTime},${result.confirm.inclusionTime},${result.burn.confirmationTime},${result.claim.confirmationTime},${result.confirm.confirmationTime},${result.burn.relayTime},${result.claim.relayTime}`);
        fs.writeSync(fd, `${run},${result.burn.gasConsumption},${result.claim.gasConsumption},${result.confirm.gasConsumption},${result.burn.cost},${result.claim.cost},${result.confirm.cost},${result.burn.inclusionTime},${result.claim.inclusionTime},${result.confirm.inclusionTime},${result.burn.confirmationTime},${result.claim.confirmationTime},${result.confirm.confirmationTime},${result.burn.relayTime},${result.claim.relayTime}\n`);
    }

    fs.closeSync(fd);
    console.log("+++ Done +++");

    process.exit();
}

async function waitUntilConfirmedWithinRelay(sourceWeb3, destWeb3, transactionHash, confirmations, relayContract) {
    const blockHash = (await sourceWeb3.eth.getTransactionReceipt(transactionHash)).blockHash;

    return new Promise(resolve => {
        const subscription = destWeb3.eth.subscribe("newBlockHeaders", async err => {
            if (err !== null) {
               console.error(err);
               return;
            }

            const isConfirmed = await relayContract.instance.methods.isBlockConfirmed(
                0,
                blockHash,
                confirmations,
            ).call();

            if (isConfirmed) {
                subscription.unsubscribe();
                resolve();
            }
        });
    });
}

const createTxMerkleProof = async (web3, chainId, block, transactionIndex) => {
    const trie = newTrie();
    for (let i = 0; i < block.transactions.length; i++) {
        const tx = await web3.eth.getTransaction(block.transactions[i]);
        const rlpTx = createRLPTransaction(tx, chainId);
        const key = encodeToBuffer(i);
        await asyncTriePut(trie, key, rlpTx);
    }

    const key = encodeToBuffer(transactionIndex);
    return encodeToBuffer(await Trie.createProof(trie, key));
};

const createReceiptMerkleProof = async (web3, block, transactionIndex) => {
    const trie = newTrie();

    for (let i = 0; i < block.transactions.length; i++) {
        const receipt = await web3.eth.getTransactionReceipt(block.transactions[i]);
        const rlpReceipt = createRLPReceipt(receipt);
        const key = encodeToBuffer(i);
        await asyncTriePut(trie, key, rlpReceipt);
    }

    const key = encodeToBuffer(transactionIndex);
    return encodeToBuffer(await Trie.createProof(trie, key));
};