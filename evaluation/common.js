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

/**
 * @returns the hash of the most recent block of the main chain stored within the relay running on the specified blockchain.
 */
const getMostRecentBlockHash = async (relayContract) =>  {
    return await relayContract.instance.methods.longestChainEndpoint().call();
};

const getHeaderInfo = async (relayContract, blockHash) => {
    return await relayContract.instance.methods.getHeader(blockHash).call();
};

const isHeaderStored = async (relayContract, blockHash) => {
    return await relayContract.instance.methods.isHeaderStored(blockHash).call();
};

module.exports = {
    callContract,
    deployContract,
    updateConfigJson,
    registerTokenContract,
    sleep,
    getMostRecentBlockHash,
    getHeaderInfo,
    isHeaderStored
};