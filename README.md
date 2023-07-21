# [AfEth Strategy Managers](https://www.asymmetry.finance/) • ![solidity](https://img.shields.io/badge/solidity-0.8.19-lightgrey)

## About

AfEth implementations built using different earning strategy nfts (votium, safEth, etc) by using a common interface to combine each strategy in any ratio

AfEth V1 will work by wrapping / managing the underlying votium & safEth strategies into a new nft.

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
