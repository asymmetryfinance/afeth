// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../../external_interfaces/IWETH.sol";
import "../../external_interfaces/ISwapRouter.sol";
import "../../external_interfaces/IVotiumMerkleStash.sol";
import "../../external_interfaces/ISnapshotDelegationRegistry.sol";
import "../../external_interfaces/ILockedCvx.sol";
import "../../external_interfaces/IClaimZap.sol";
import "../../external_interfaces/ICrvEthPool.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import "hardhat/console.sol";

contract VotiumErc20StrategyCore is
    Initializable,
    OwnableUpgradeable,
    ERC20Upgradeable
{
    address public constant SNAPSHOT_DELEGATE_REGISTRY =
        0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446;
    address constant CVX_ADDRESS = 0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B;
    address constant VLCVX_ADDRESS = 0x72a19342e8F1838460eBFCCEf09F6585e32db86E;

    error SwapFailed(uint256 index);

    struct SwapData {
        address sellToken;
        address spender;
        address swapTarget;
        bytes swapCallData;
    }

    struct UnlockQueuePosition {
        uint256 afEthOwed; // how much afEth total is owed for this position
        uint256 priceWhenRequested; // afEth price when withdraw requested
    }

    mapping(address => mapping(uint256 => UnlockQueuePosition))
        public unlockQueues;

    uint256 public afEthUnlockObligations;

    // epoch => price
    mapping(uint256 => uint256) public priceUpdates;
    uint256 priceUpdateslength;

    address rewarder;

    // used to add storage variables in the future
    uint256[50] private __gap;

    modifier onlyRewarder() {
        require(msg.sender == rewarder, "not rewarder");
        _;
    }

    // As recommended by https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
        @notice - Function to initialize values for the contracts
        @dev - This replaces the constructor for upgradeable contracts
    */
    function initialize(
        address _owner,
        address _rewarder
    ) external initializer {
        bytes32 VotiumVoteDelegationId = 0x6376782e65746800000000000000000000000000000000000000000000000000;
        address DelegationRegistry = 0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446;
        address votiumVoteProxyAddress = 0xde1E6A7ED0ad3F61D531a8a78E83CcDdbd6E0c49;
        ISnapshotDelegationRegistry(DelegationRegistry).setDelegate(
            VotiumVoteDelegationId,
            votiumVoteProxyAddress
        );
        rewarder = _rewarder;
        _transferOwnership(_owner);
        recordPriceUpdate();
        _mint(address(this), 100);
    }

    function setRewarder(address _rewarder) external onlyOwner {
        rewarder = _rewarder;
    }

    function price() public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 1e18;
        (uint256 total, , , ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(
            address(this)
        );
        uint256 cvxInSystem = total +
            IERC20(CVX_ADDRESS).balanceOf(address(this));
        if (cvxInSystem == 0) return 1e18;
        return (cvxInSystem * 1e18) / supply;
    }

    /// apply rewards, price goes up
    function claimRewards(
        IVotiumMerkleStash.ClaimParam[] calldata _claimProofs
    ) public onlyRewarder {
        claimVotiumRewards(_claimProofs);
        claimvlCvxRewards();
    }

    /// anyone can deposit eth to make price go up
    /// useful if we need to manually sell rewards ourselves
    // TODO: anyone can lock all eth in the contract, maybe we should make this onlyOwner? Maybe ok?
    function depositRewards(uint256 _amount) public payable {
        uint256 cvxAmount = buyCvx(_amount);
        IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmount);
        ILockedCvx(VLCVX_ADDRESS).lock(address(this), cvxAmount, 0);
        recordPriceUpdate();
    }

    function withdrawStuckTokens(address _token) public onlyOwner {
        IERC20(_token).transfer(
            msg.sender,
            IERC20(_token).balanceOf(address(this))
        );
    }

    function buyCvx(
        uint256 _ethAmountIn
    ) internal returns (uint256 cvxAmountOut) {
        address CVX_ETH_CRV_POOL_ADDRESS = 0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4;
        // eth -> cvx
        uint256 cvxBalanceBefore = IERC20(CVX_ADDRESS).balanceOf(address(this));
        ICrvEthPool(CVX_ETH_CRV_POOL_ADDRESS).exchange_underlying{
            value: _ethAmountIn
        }(
            0,
            1,
            _ethAmountIn,
            0 // TODO minout to something
        );
        uint256 cvxBalanceAfter = IERC20(CVX_ADDRESS).balanceOf(address(this));
        cvxAmountOut = cvxBalanceAfter - cvxBalanceBefore;
    }

    function sellCvx(
        uint256 _cvxAmountIn
    ) internal returns (uint256 ethAmountOut) {
        address CVX_ETH_CRV_POOL_ADDRESS = 0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4;
        // cvx -> eth
        uint256 ethBalanceBefore = address(this).balance;
        IERC20(CVX_ADDRESS).approve(CVX_ETH_CRV_POOL_ADDRESS, _cvxAmountIn);

        ICrvEthPool(CVX_ETH_CRV_POOL_ADDRESS).exchange_underlying(
            1,
            0,
            _cvxAmountIn,
            0 // TODO minout to something
        );
        ethAmountOut = address(this).balance - ethBalanceBefore;
    }

    /// sell any number of erc20's via 0x in a single tx
    function applyRewards(SwapData[] calldata _swapsData) public onlyRewarder {
        uint256 ethBalanceBefore = address(this).balance;
        for (uint256 i = 0; i < _swapsData.length; i++) {
            // Some tokens do not allow approval if allowance already exists
            uint256 allowance = IERC20(_swapsData[i].sellToken).allowance(
                address(this),
                address(_swapsData[i].spender)
            );
            if (allowance != type(uint256).max) {
                if (allowance > 0) {
                    IERC20(_swapsData[i].sellToken).approve(
                        address(_swapsData[i].spender),
                        0
                    );
                }
                IERC20(_swapsData[i].sellToken).approve(
                    address(_swapsData[i].spender),
                    type(uint256).max
                );
            }
            (bool success, ) = _swapsData[i].swapTarget.call(
                _swapsData[i].swapCallData
            );
            if (!success) {
                console.log('FAILED TO SELL', _swapsData[i].sellToken);
                // TODO emit an event or something?
                // this causes unsold tokens to build up in the contract, see:
                // https://app.zenhub.com/workspaces/af-engineering-636020e6fe7394001d996825/issues/gh/asymmetryfinance/safeth/478
            } else {
                console.log('successfully sold', _swapsData[i].sellToken);
            }
        }
        uint256 ethBalanceAfter = address(this).balance;
        depositRewards(ethBalanceAfter - ethBalanceBefore);
    }

    function recordPriceUpdate() private {
        uint256 currentEpoch = ILockedCvx(VLCVX_ADDRESS).findEpochId(
            block.timestamp
        );
        priceUpdates[currentEpoch] = price();
    }

    function claimVotiumRewards(
        IVotiumMerkleStash.ClaimParam[] calldata _claimProofs
    ) private {
        IVotiumMerkleStash(0x378Ba9B73309bE80BF4C2c027aAD799766a7ED5A)
            .claimMulti(address(this), _claimProofs);
    }

    function claimvlCvxRewards() private {
        address[] memory emptyArray;
        IClaimZap(0x3f29cB4111CbdA8081642DA1f75B3c12DECf2516).claimRewards(
            emptyArray,
            emptyArray,
            emptyArray,
            emptyArray,
            0,
            0,
            0,
            0,
            8
        );
    }

    receive() external payable {}
}
