const fs = require("fs");
const { callContract } = require("../common");
const initNetwork = require("./network");
const config = require("./config");

deployContracts();

async function deployContracts() {
    console.log("Deploying contracts...");

    const [network0, network1] = [config[0], config[1]];
    const [network0Instance, network1Instance] = [initNetwork(network0), initNetwork(network1)];
    
    await Promise.all([
        deployOnNetwork(network0, network0Instance),
        deployOnNetwork(network1, network1Instance),
    ]);

    await Promise.all([
        registerTokenContract(network0.name, network0Instance, network1.contracts.protocol.address, network0.accounts.user.address),
        registerTokenContract(network1.name, network1Instance, network0.contracts.protocol.address, network1.accounts.user.address),
    ]);

    updateConfigJson(config);
    console.log("Deployment completed");
}

async function deployOnNetwork(jsonConfig, networkConfig) {
    const contracts = jsonConfig.contracts;

    contracts.distKey.address = await deployContract(jsonConfig, networkConfig.contracts.distKey);
    contracts.registry.address = await deployContract(jsonConfig, networkConfig.contracts.registry, [contracts.distKey.address]);

    await callContract(
        jsonConfig.name,
        networkConfig.contracts.distKey.instance.methods.setRegistryContract(contracts.registry.address),
        jsonConfig.accounts.user.address,
    );

    contracts.oracle.address = await deployContract(jsonConfig, networkConfig.contracts.oracle, [contracts.registry.address, contracts.distKey.address]);

    contracts.protocol.address = await deployContract(jsonConfig, networkConfig.contracts.protocol, [
        [],
        contracts.oracle.address,
        100000000,
    ]);
}

async function deployContract(jsonConfig, contract, constructorArguments) {
    console.log(`Deploying contract ${contract.name} on ${jsonConfig.name}...`);

    contract.instance.options.from = jsonConfig.accounts.user.address;

    const tx = contract.instance.deploy({
        data: contract.bytecode,
        arguments: constructorArguments,
    });

    const address = (await tx.send({
        "gas": await tx.estimateGas(),
    })).options.address;

    contract.instance.options.address = address;
    
    console.log(`Contract ${contract.name} deployed at ${address} on ${jsonConfig.name}`);

    return address;
}

async function registerTokenContract(networkName, networkInstance, contractAddrToRegister, from) {
    return await callContract(
        networkName,
        networkInstance.contracts.protocol.instance.methods.registerTokenContract(contractAddrToRegister),
        from,
    );
}

function updateConfigJson(config) {
   const jsonString = JSON.stringify(config, null, 2);
   fs.writeFileSync("./config.json", jsonString);
}
