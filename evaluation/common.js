const fs = require("fs");
const path = require("path")

const callContract = async (name, method, from) => {
    console.log(`Calling method ${method._method.name} on ${name}`);

    const txReceipt = await method.send({
        "gas": await method.estimateGas({from}),
        from,
    });

    console.log(`New transaction on ${name} with hash ${txReceipt.transactionHash}`);

    return txReceipt;
};

async function deployContract(jsonConfig, contract, constructorArguments) {
    console.log(`Deploying contract ${contract.name} on ${jsonConfig.name}...`);

    const from = jsonConfig.accounts.user.address;
    contract.instance.options.from = from;

    const tx = contract.instance.deploy({
        data: contract.bytecode,
        arguments: constructorArguments,
    });

    const address = (await tx.send({
        "gas": await tx.estimateGas({from}),
        from,
    })).options.address;

    contract.instance.options.address = address;
    
    console.log(`Contract ${contract.name} deployed at ${address} on ${jsonConfig.name}`);

    return address;
}

function updateConfigJson(config, dirname) {
    const jsonString = JSON.stringify(config, null, 2);
    fs.writeFileSync(path.resolve(dirname, "config.json"), jsonString);
}

async function registerTokenContract(networkName, networkInstance, contractAddrToRegister, from) {
    return await callContract(
        networkName,
        networkInstance.contracts.protocol.instance.methods.registerTokenContract(contractAddrToRegister),
        from,
    );
}

const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

function burn(jsonConfig, networkInstance, recipientAddr, claimContractAddr, value, stake) {
    return callContract(
        jsonConfig.name,
        networkInstance.contracts.protocol.instance.methods.burn(recipientAddr, claimContractAddr, value, stake),
        jsonConfig.accounts.user.address,
    );
}

function claim(jsonConfig, networkInstance, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path) {
    return callContract(
        jsonConfig.name,
        networkInstance.contracts.protocol.instance.methods.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path),
        jsonConfig.accounts.user.address,
    );
}

function confirm(jsonConfig, networkInstance, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path) {
    return callContract(
        jsonConfig.name,
        networkInstance.contracts.protocol.instance.methods.confirm(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path),
        jsonConfig.accounts.user.address,
    );
}

async function waitUntilConfirmed(web3, txHash, confirmations) {
    while (true) {
        const receipt = await web3.eth.getTransactionReceipt(txHash);
        if (receipt !== null) {
            const mostRecentBlockNumber = await web3.eth.getBlockNumber();
            if (receipt.blockNumber + confirmations <= mostRecentBlockNumber) {
                // receipt != null -> tx is part of main chain
                // and block containing tx has at least confirmations successors
                break;
            }
        }
        await sleep(1500);
    }
}

module.exports = {
    callContract,
    deployContract,
    updateConfigJson,
    registerTokenContract,
    sleep,
    burn,
    claim,
    confirm,
    waitUntilConfirmed,
};