const {
    asyncTriePut,
    newTrie,
    createRLPHeader,
    createRLPTransaction,
    createRLPReceipt,
    encodeToBuffer,
} = require("../../utils");
const fs = require("fs");
const {BaseTrie: Trie} = require("merkle-patricia-tree");
const {burn, claim, confirm, waitUntilConfirmed} = require("../common");
const initNetwork = require("../network");
const config = require("./config");

const RUNS = 100;

const network0Instance = initNetwork(config[0]);
const network1Instance = initNetwork(config[1]);

(async () => {
    await startEvaluation();
    process.exit();
})();

async function startEvaluation() {
    console.log("+++ Starting evaluation +++");

    const fd = fs.openSync("./results.csv", "w");
    fs.writeSync(fd, "run,burn_gas,claim_gas,confirm_gas,burn_cost,claim_cost,confirm_cost,burn_incTime,claim_incTime,confirm_incTime,burn_confTime,claim_confTime,confirm_confTime,burn_confTimeRelay,claim_confTimeRelay\n");

    for (let run = 1; run <= RUNS; run++) {
        let result = {
            burn: {},
            claim: {},
            confirm: {}
        };
        console.log("Run:", run);

        const [config0, config1] = [config[0], config[1]];

        // submit burn transaction
        let balanceInWeiBefore = BigInt(await network0Instance.web3.eth.getBalance(config0.accounts.user.address));
        let startTime = new Date().getTime();
        let burnReceipt;
        try {
            burnReceipt = await burn(config0, network0Instance, config1.accounts.user.address, config1.contracts.protocol.address, 1, 0);
        } catch (e) {
            console.log(e.message);
            run--;
            continue;
        }
        let endTime = new Date().getTime();
        let balanceInWeiAfter = BigInt(await network0Instance.web3.eth.getBalance(config0.accounts.user.address));
        result.burn.inclusionTime = (endTime - startTime) / 1000;  // diff in seconds
        result.burn.gasConsumption = burnReceipt.gasUsed;
        result.burn.cost = balanceInWeiBefore - balanceInWeiAfter;

        console.log("wait for confirmation of burn tx ...");
        startTime = new Date().getTime();
        await waitUntilConfirmed(network0Instance.web3, burnReceipt.transactionHash, config0.confirmations);
        endTime = new Date().getTime();
        result.burn.confirmationTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log("burn tx is confirmed");

        console.log("wait for burn tx to be confirmed within relay running on Ropsten ...");
        startTime = new Date().getTime();
        await waitUntilConfirmedWithinRelay(network0Instance.web3, network1Instance.web3, burnReceipt.transactionHash, config0.confirmations, network1Instance.contracts.relay);
        endTime = new Date().getTime();
        result.burn.relayTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log("burn tx is confirmed within relay");


        // submit claim transaction
        burnReceipt = await network0Instance.web3.eth.getTransactionReceipt(burnReceipt.transactionHash);  // load receipt again to be on the safe side if chain reorganization occurred
        let block = await network0Instance.web3.eth.getBlock(burnReceipt.blockHash);
        let tx = await network0Instance.web3.eth.getTransaction(burnReceipt.transactionHash);
        let txReceipt = await network0Instance.web3.eth.getTransactionReceipt(burnReceipt.transactionHash);
        let rlpHeader = createRLPHeader(block);
        let rlpEncodedTx = createRLPTransaction(tx, config0.chainId);
        let rlpEncodedReceipt = createRLPReceipt(txReceipt);
        let path = encodeToBuffer(tx.transactionIndex);
        let rlpEncodedTxNodes = await createTxMerkleProof(network0Instance.web3, config0.chainId, block, tx.transactionIndex);
        let rlpEncodedReceiptNodes = await createReceiptMerkleProof(network0Instance.web3, block, tx.transactionIndex);

        balanceInWeiBefore = BigInt(await network1Instance.web3.eth.getBalance(config1.accounts.user.address));
        startTime = new Date().getTime();
        let claimReceipt;
        try{
            claimReceipt = await claim(config1, network1Instance, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path);
        } catch (e) {
            console.log(e.message);
            run--;
            continue;
        }
        endTime = new Date().getTime();
        balanceInWeiAfter = BigInt(await network1Instance.web3.eth.getBalance(config1.accounts.user.address));
        result.claim.inclusionTime = (endTime - startTime) / 1000;  // diff in seconds
        result.claim.gasConsumption = claimReceipt.gasUsed;
        result.claim.cost = balanceInWeiBefore - balanceInWeiAfter;

        console.log("wait for confirmation of claim tx ...");
        startTime = new Date().getTime();
        await waitUntilConfirmed(network1Instance.web3, claimReceipt.transactionHash, config1.confirmations);
        endTime = new Date().getTime();
        result.claim.confirmationTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log("claim tx is confirmed");

        console.log("wait for claim tx to be confirmed within relay running on Rinkeby ...");
        startTime = new Date().getTime();
        await waitUntilConfirmedWithinRelay(network1Instance.web3, network0Instance.web3, claimReceipt.transactionHash, config1.confirmations, network0Instance.contracts.relay);
        endTime = new Date().getTime();
        result.claim.relayTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log("claim tx is confirmed within relay");


        // submit confirm transaction
        claimReceipt = await network1Instance.web3.eth.getTransactionReceipt(claimReceipt.transactionHash);  // load receipt again to be on the safe side if chain reorganization occurred
        block = await network1Instance.web3.eth.getBlock(claimReceipt.blockHash);
        tx = await network1Instance.web3.eth.getTransaction(claimReceipt.transactionHash);
        txReceipt = await network1Instance.web3.eth.getTransactionReceipt(claimReceipt.transactionHash);
        rlpHeader = createRLPHeader(block);
        rlpEncodedTx = createRLPTransaction(tx, config1.chainId);
        rlpEncodedReceipt = createRLPReceipt(txReceipt);
        path = encodeToBuffer(tx.transactionIndex);
        rlpEncodedTxNodes = await createTxMerkleProof(network1Instance.web3, config1.chainId, block, tx.transactionIndex);
        rlpEncodedReceiptNodes = await createReceiptMerkleProof(network1Instance.web3, block, tx.transactionIndex);

        balanceInWeiBefore = BigInt(await network0Instance.web3.eth.getBalance(config0.accounts.user.address));
        startTime = new Date().getTime();
        let confirmReceipt;
        try {
            confirmReceipt = await confirm(config0, network0Instance, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path);
        } catch (err) {
            console.log(err);
            run--;
            continue;
        }
        endTime = new Date().getTime();
        balanceInWeiAfter = BigInt(await network0Instance.web3.eth.getBalance(config0.accounts.user.address));
        result.confirm.inclusionTime = (endTime - startTime) / 1000;  // diff in seconds
        result.confirm.gasConsumption = confirmReceipt.gasUsed;
        result.confirm.cost = balanceInWeiBefore - balanceInWeiAfter;

        console.log("wait for confirmation of confirm tx ...");
        startTime = new Date().getTime();
        await waitUntilConfirmed(network0Instance.web3, confirmReceipt.transactionHash, config0.confirmations);
        endTime = new Date().getTime();
        result.confirm.confirmationTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log("confirm tx is confirmed");

        console.log(`${run}: ${result.burn.gasConsumption},${result.claim.gasConsumption},${result.confirm.gasConsumption},${result.burn.cost},${result.claim.cost},${result.confirm.cost},${result.burn.inclusionTime},${result.claim.inclusionTime},${result.confirm.inclusionTime},${result.burn.confirmationTime},${result.claim.confirmationTime},${result.confirm.confirmationTime},${result.burn.relayTime},${result.claim.relayTime}`);
        fs.writeSync(fd, `${run},${result.burn.gasConsumption},${result.claim.gasConsumption},${result.confirm.gasConsumption},${result.burn.cost},${result.claim.cost},${result.confirm.cost},${result.burn.inclusionTime},${result.claim.inclusionTime},${result.confirm.inclusionTime},${result.burn.confirmationTime},${result.claim.confirmationTime},${result.confirm.confirmationTime},${result.burn.relayTime},${result.claim.relayTime}\n`);
    }

    fs.closeSync(fd);
    console.log("+++ Done +++");
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
