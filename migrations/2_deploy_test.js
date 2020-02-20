const TokenContract = artifacts.require('BurnClaim');
const TxInclusionVerifier = artifacts.require('MockedTxInclusionVerifier');

module.exports = async function(deployer, network) {
    if (network !== 'test') {
        return;
    }

    await deployer.deploy(TxInclusionVerifier, 1, 1, true);
    await deployer.deploy(TokenContract, [], TxInclusionVerifier.address, 10);

};
