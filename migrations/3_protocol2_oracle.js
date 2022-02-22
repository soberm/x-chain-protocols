const TokenContract = artifacts.require("Protocol2");
const TxInclusionVerifier = artifacts.require("OracleContractTxInclusionVerifier");
const RegistryContract = artifacts.require("RegistryContract");
const DistKeyContract = artifacts.require("DistKeyContract");

module.exports = async deployer => {
    await deployer.deploy(DistKeyContract);
    await deployer.deploy(RegistryContract, DistKeyContract.address);

    (await DistKeyContract.deployed()).setRegistryContract(RegistryContract.address);

    await deployer.deploy(TxInclusionVerifier, RegistryContract.address, DistKeyContract.address);

    await deployer.deploy(TokenContract, [], TxInclusionVerifier.address, 10);
}
