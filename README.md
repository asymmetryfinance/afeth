# [Asymmetry Finance Strategy Manager](https://www.asymmetry.finance/) • ![solidity](https://img.shields.io/badge/solidity-0.8.19-lightgrey)

## About

Monorepo containing a strategy manager contract and nft-wrapped strategies that can be mixed and matched in various combinations. This will be used to create afEth by combining votium and safEth strategies in the manager

## Local Development

To use the correct node version run

```
nvm use
```

To install dependencies and compile run

```
yarn && yarn compile
```

## Testing

### Hardhat

For testing on hardhat simply run:

```
yarn test
```

Or for complete coverage:

```
yarn coverage
```

### Local Node

Run the following command to spin up your local node

```
yarn local:node
```

In another terminal run this command to deploy the contracts to your local node

```
yarn deploy --network localhost
```

Once deployed you can interact with your local contracts through Ethernal or scripts/tests
