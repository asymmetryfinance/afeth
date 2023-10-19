import { AfEth, VotiumStrategy } from "../typechain-types";
import { ethers, network, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { MULTI_SIG, RETH_DERIVATIVE, WST_DERIVATIVE } from "./constants";
import { expect } from "chai";
import { derivativeAbi } from "./abis/derivativeAbi";
import { stEthAbi } from "./abis/stEthAbi";

describe.only("Test Cow Hooks", async function () {
  let afEth: AfEth;
  let votiumStrategy: VotiumStrategy;
  let accounts: SignerWithAddress[];
  const STETH_ADDRESS = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";

  const initialStake = ethers.utils.parseEther(".1");
  const initialStakeAccount = 11;

  const nowPlusOneMinute = async () =>
    (await ethers.provider.getBlock("latest")).timestamp + 60;

  const resetToBlock = async (blockNumber: number) => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_URL,
            blockNumber,
          },
        },
      ],
    });
    accounts = await ethers.getSigners();
    const afEthFactory = await ethers.getContractFactory("AfEth");
    afEth = (await upgrades.deployProxy(afEthFactory, [])) as AfEth;
    await afEth.deployed();
    const votiumFactory = await ethers.getContractFactory("VotiumStrategy");
    votiumStrategy = (await upgrades.deployProxy(votiumFactory, [
      accounts[0].address,
      accounts[0].address,
      afEth.address,
    ])) as VotiumStrategy;
    await votiumStrategy.deployed();

    await afEth.setStrategyAddress(votiumStrategy.address);
    // mock chainlink feeds so not out of date
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [MULTI_SIG],
    });

    const chainLinkRethFeedFactory = await ethers.getContractFactory(
      "ChainLinkRethFeedMock"
    );
    const chainLinkWstFeedFactory = await ethers.getContractFactory(
      "ChainLinkWstFeedMock"
    );

    const chainLinkRethFeed = await chainLinkRethFeedFactory.deploy();
    const chainLinkWstFeed = await chainLinkWstFeedFactory.deploy();

    const multiSigSigner = await ethers.getSigner(MULTI_SIG);

    // mock chainlink feed on derivatives
    const rEthDerivative = new ethers.Contract(
      RETH_DERIVATIVE,
      derivativeAbi,
      accounts[0]
    );
    const multiSigReth = rEthDerivative.connect(multiSigSigner);
    await multiSigReth.setChainlinkFeed(chainLinkRethFeed.address);

    const wstEthDerivative = new ethers.Contract(
      WST_DERIVATIVE,
      derivativeAbi,
      accounts[0]
    );

    const multiSigWst = wstEthDerivative.connect(multiSigSigner);
    await multiSigWst.setChainlinkFeed(chainLinkWstFeed.address);
    // mint some to seed the system so totalSupply is never 0 (prevent price weirdness on withdraw)
    const tx = await afEth
      .connect(accounts[initialStakeAccount])
      .deposit(0, await nowPlusOneMinute(), {
        value: initialStake,
      });
    await tx.wait();

    const chainLinkCvxEthFeedFactory = await ethers.getContractFactory(
      "ChainLinkCvxEthFeedMock"
    );
    const chainLinkCvxEthFeed = await chainLinkCvxEthFeedFactory.deploy();
    await chainLinkCvxEthFeed.deployed();
    await votiumStrategy.setChainlinkCvxEthFeed(chainLinkCvxEthFeed.address);

    await afEth.setRewarderAddress(accounts[0].address);

    const STETH_WHALE = "0x2bf3937b8BcccE4B65650F122Bb3f1976B937B2f";
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [STETH_WHALE],
    });
    const impersonatedWhaleSigner = await ethers.getSigner(STETH_WHALE);
    const stEth = new ethers.Contract(STETH_ADDRESS, stEthAbi, accounts[0]);
    await stEth
      .connect(impersonatedWhaleSigner)
      .transfer(accounts[0].address, ethers.utils.parseEther("100"));
  };

  beforeEach(
    async () => await resetToBlock(parseInt(process.env.BLOCK_NUMBER ?? "0"))
  );

  it("Should permit & swap stEth to Eth, then deposit into AfEth", async function () {
    const { chainId } = await ethers.provider.getNetwork();
    const wallet = accounts[0];
    const SETTLEMENT = new ethers.Contract(
      "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
      [],
      ethers.provider
    );

    const VAULT_RELAYER = new ethers.Contract(
      "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110",
      [],
      ethers.provider
    );

    const COW = new ethers.Contract(
      "0xDEf1CA1fb7FBcDC777520aa7f396b4E015F497aB",
      [],
      ethers.provider
    );

    const STETH = new ethers.Contract(STETH_ADDRESS, stEthAbi, ethers.provider);

    /** Order Configuration **/

    const orderConfig = {
      sellToken: STETH.address,
      buyToken: COW.address,
      sellAmount: ethers.utils.parseEther("1"),
      kind: "sell",
      partiallyFillable: false,
      sellTokenBalance: "erc20",
      buyTokenBalance: "erc20",
    } as any;

    /** EIP-2612 Permit **/

    const permit = {
      owner: wallet.address,
      spender: VAULT_RELAYER.address,
      value: orderConfig.sellAmount,
      nonce: await STETH.nonces(wallet.address),
      deadline: ethers.constants.MaxUint256,
    };
    const permitSignature = ethers.utils.splitSignature(
      await wallet._signTypedData(
        {
          name: await STETH.name(),
          version: "2",
          chainId,
          verifyingContract: STETH.address,
        },
        {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        permit
      )
    );
    const permitParams = [
      permit.owner,
      permit.spender,
      permit.value,
      permit.deadline,
      permitSignature.v,
      permitSignature.r,
      permitSignature.s,
    ];
    const permitHook = {
      target: STETH.address,
      callData: STETH.interface.encodeFunctionData("permit", permitParams),
      gasLimit: `${await STETH.estimateGas.permit(...permitParams)}`,
    };
    console.log("permit hook:", permitHook);

    /** AfEth Deposit **/

    orderConfig.receiver = wallet.address;
    const depositHook = {
      target: afEth.address,
      callData: afEth.interface.encodeFunctionData("deposit", [
        0,
        ethers.constants.MaxUint256,
      ]),
      gasLimit: "2285300", // TODO: set gas limit
    };
    console.log("deposit hook:", depositHook);

    /** Order Creation **/

    orderConfig.appData = JSON.stringify({
      metadata: {
        hooks: {
          pre: [permitHook],
          post: [depositHook],
        },
      },
    });

    const res = await fetch("https://barn.api.cow.fi/mainnet/api/v1/quote", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: wallet.address,
        sellAmountBeforeFee: orderConfig.sellAmount,
        ...orderConfig,
      }),
    }).then((response) => {
      console.log("response:", response);
      return response.json();
    });
    console.log("quote:", res); // quoteId, quote);

    // const orderData = {
    //   ...orderConfig,
    //   sellAmount: quote.sellAmount,
    //   buyAmount: `${ethers.BigNumber.from(quote.buyAmount).mul(99).div(100)}`,
    //   validTo: quote.validTo,
    //   appData: ethers.utils.id(orderConfig.appData),
    //   feeAmount: quote.feeAmount,
    // };

    // const orderSignature = await wallet._signTypedData(
    //   {
    //     name: "Gnosis Protocol",
    //     version: "v2",
    //     chainId,
    //     verifyingContract: SETTLEMENT.address,
    //   },
    //   {
    //     Order: [
    //       { name: "sellToken", type: "address" },
    //       { name: "buyToken", type: "address" },
    //       { name: "receiver", type: "address" },
    //       { name: "sellAmount", type: "uint256" },
    //       { name: "buyAmount", type: "uint256" },
    //       { name: "validTo", type: "uint32" },
    //       { name: "appData", type: "bytes32" },
    //       { name: "feeAmount", type: "uint256" },
    //       { name: "kind", type: "string" },
    //       { name: "partiallyFillable", type: "bool" },
    //       { name: "sellTokenBalance", type: "string" },
    //       { name: "buyTokenBalance", type: "string" },
    //     ],
    //   },
    //   orderData
    // );

    // const orderUid = await fetch(
    //   "https://barn.api.cow.fi/mainnet/api/v1/orders",
    //   {
    //     method: "POST",
    //     headers: {
    //       "content-type": "application/json",
    //     },
    //     body: JSON.stringify({
    //       ...orderData,
    //       from: wallet.address,
    //       appData: orderConfig.appData,
    //       appDataHash: orderData.appData,
    //       signingScheme: "eip712",
    //       signature: orderSignature,
    //       quoteId,
    //     }),
    //   }
    // ).then((response) => response.json());
    // console.log("order:", orderUid);
  });
});
