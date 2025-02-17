# Cross-Blockchain Asset Transfer Protocols

This project contains Ethereum smart contracts enabling decentralized cross-blockchain asset transfers between EVM-based blockchains. The provided implementation allows users to transfer ERC-20 tokens from one blockchain to another in a completely decentralized way.
For that, the provided smart contracts need to be deployed on each participating blockchain.

> _Important: This project is a research prototype demonstrating the feasibility of cross-blockchain asset transfer protocols. Use it with care in production systems._

## Installation

In order to correctly clone this project with its submodules, supply the `--recurse-submodules` flag to the clone command.
If you have already cloned the repo, run `git submodule update --init --recursive`.

The following guide will walk you through the deployment of the provided smart contracts on a local blockchain (Ganache).

### Prerequisites

You need to have the following tools installed:

* [Node](https://nodejs.org/en/)
* [Ganache](https://www.trufflesuite.com/ganache) (>= 2.1.0)

### Deployment

1. Install all dependencies: `npm install`
2. Deploy contracts: `truffle migrate --reset`

### Testing

Run the tests with `truffle test`.

Apart from conducting tests on a single blockchain, the directory `/evaluation` contains scripts for conducting asset transfers between two EVM-based blockchains, e.g., to send ERC-20 tokens from Rinkeby to Ropsten.
Scripts are available for two different transaction inclusion verifiers, namely via [ETH Relay](https://github.com/pantos-io/ethrelay) and an [oracle](https://github.com/pantos-io/ioporacle).

In order to start the evaluation, execute the following steps:

1. Change the directory to either `oracle` or `relay`, depending on your choice of transaction inclusion verifier.
2. Provide the chain and account information in `config.json` (an example config can be found in `config.example.json`).
3. Run `node deploy.js` in order to deploy the contracts on the configured networks. Contract addresses will be filled into the config file automatically.

4. _Relay only:_ Run `node submit.js rinkeby` and `node submit.js ropsten` in two separate processes to start relaying block headers.
   
   _Oracle only:_ Start the oracle nodes (see respective [repository for instructions](https://github.com/pantos-io/ioporacle))

5. Run `node evaluation.js` to start the evaluation script.

### Transaction Inclusion Verification

The implemented concepts rely on a mechanism to verify within some blockchain whether a transaction has been included and confirmed by enough succeeding blocks on some other blockchains.
If you wish to run the implementation with some other verifiers that are not included in the project, please make sure that the corresponding smart contract implements the interfaces specified in `contracts/TxInclusionVerifier.sol`.

## How to contribute

This project is a research prototype. We welcome anyone to contribute.
File a bug report or submit feature requests through the [issue tracker](https://github.com/pf92/x-chain-protocols/issues).
If you want to contribute feel free to submit a pull request.

## Licence

This project is licensed under the [MIT License](LICENSE).
