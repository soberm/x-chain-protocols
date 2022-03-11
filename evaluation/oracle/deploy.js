const {callContract, deployContract, registerTokenContract, updateConfigJson} = require("../common");
const initNetwork = require("../network");
const config = require("./config");

(async () => {
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

    updateConfigJson(config, __dirname);
    console.log("Deployment completed");

    process.exit();
})();

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
