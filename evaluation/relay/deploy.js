const {deployContract, registerTokenContract, updateConfigJson} = require("../common");
const {createRLPHeader} = require("../../utils");
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

   contracts.ethash.address = await deployContract(jsonConfig, networkConfig.contracts.ethash);

   const mostRecentBlock = await ropstenNetworkInstance.web3.eth.getBlock("latest");
   const genesisBlock = await ropstenNetworkInstance.web3.eth.getBlock(mostRecentBlock.number - 10);  // make sure genesis block is confirmed by enough blocks
   const rlpHeader = createRLPHeader(genesisBlock);

   contracts.relay.address = await deployContract(jsonConfig, networkConfig.contracts.relay, [
      rlpHeader,
      genesisBlock.totalDifficulty,
      contracts.ethash.address,
   ]);

   contracts.relay.genesisBlock = genesisBlock.number;

   contracts.protocol.address = await deployContract(jsonConfig, networkConfig.contracts.protocol, [
      [],
      contracts.relay.address,
      100000000,
  ]);
}
