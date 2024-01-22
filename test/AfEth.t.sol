// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import {BaseTest} from "./utils/BaseTest.sol";
import {IAfEth} from "../src/interfaces/afeth/IAfEth.sol";
import {IVotiumStrategy} from "../src/interfaces/afeth/IVotiumStrategy.sol";
import {CvxEthOracleLib} from "../src/utils/CvxEthOracleLib.sol";
import {CVX} from "../src/interfaces/curve-convex/Constants.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {MockOracle} from "./mocks/MockOracle.sol";
import {CvxEthOracleLib} from "../src/utils/CvxEthOracleLib.sol";

import {console2 as console} from "forge-std/console2.sol";

/// @author philogy <https://github.com/philogy>
contract AfEthTest is BaseTest {
    using SafeTransferLib for address;

    function testDefaultPrice() public {
        assertEq(afEth.price(), 1e18);
        assertEq(afEth.totalSupply(), 0);
    }

    function testFirstMint() public {
        address user = makeAddr("user");
        startHoax(user, 2 ether);

        uint256 preBal = afEth.balanceOf(user);
        uint256 amountOut = afEth.deposit{value: 2 ether}(0, block.timestamp);
        uint256 afterBal = afEth.balanceOf(user);

        vm.stopPrank();

        assertEq(afterBal - preBal, amountOut, "Did not reported afETH");
        assertEq(afEth.totalEthValue(), amountOut);
    }

    function testRevertsIfOutputBelowMin() public {
        address user = makeAddr("user");

        uint256 beforeDepositSnapshot = vm.snapshot();

        uint256 depositAmount = 1.3 ether;
        hoax(user, depositAmount);
        uint256 amountOut = afEth.deposit{value: depositAmount}(0, block.timestamp);

        vm.revertTo(beforeDepositSnapshot);

        vm.expectRevert(IAfEth.BelowMinOut.selector);
        hoax(user, depositAmount);
        afEth.deposit{value: depositAmount}(amountOut + 1, block.timestamp);
    }

    function testSimpleWithdrawLockedCvx() public {
        address user = makeAddr("user");
        uint256 value = 1.45 ether;
        hoax(user, value);
        uint256 amountOut = afEth.deposit{value: value}(0, block.timestamp);

        uint256 redeemAmount = amountOut / 3;

        vm.prank(user);
        uint256 balBefore = user.balance;
        (bool locked, uint256 cumulativeUnlockThreshold) = afEth.requestWithdraw(redeemAmount, 0, 0, block.timestamp);
        uint256 ethReceived = user.balance - balBefore;

        assertTrue(locked);

        uint256 cvxLocked = votium.withdrawableAfterUnlocked(user, cumulativeUnlockThreshold);

        uint256 ethValue = CvxEthOracleLib.convertToEth(cvxLocked) + ethReceived;

        assertApproxEqRelDecimal(
            ethValue,
            value * redeemAmount / amountOut,
            0.005e18,
            18,
            "Received value not approx. staked value (within 0.5%)"
        );

        skip(20 weeks);

        uint256 cvxBefore = CVX.balanceOf(user);
        vm.prank(user);
        votium.withdrawLocked(cumulativeUnlockThreshold, 0, block.timestamp);
        uint256 cvxAfter = CVX.balanceOf(user);

        assertEq(cvxAfter - cvxBefore, cvxLocked);
    }

    function testRewardDistributionLocksReward() public {
        {
            address user = makeAddr("user");
            uint256 value = 1.45 ether;
            hoax(user, value);
            afEth.deposit{value: value}(0, block.timestamp);
        }

        uint256 reward = 31.98 ether;
        hoax(rewarder, reward);
        afEth.depositRewardsAndRebalance{value: reward}(IAfEth.RebalanceParams(0, 0, 0, block.timestamp));

        (uint256 sfrxRatio,,, uint256 unlocked, uint256 locked) = afEth.reportValue();

        assertApproxEqRelDecimal(sfrxRatio, 0.7e18, 0.001e18, 18, "sfrxETH:votium ratio not close to 70%");

        assertEq(locked, reward);
        assertEq(unlocked, 0);

        MockOracle cvxOracle = overwriteOracle(address(CvxEthOracleLib.CVX_ETH_ORACLE));

        skip(1.5 weeks);

        cvxOracle.update();

        assertEq(lockedRewards(), reward / 4);

        cvxOracle.update(cvxOracle.price() * 88 / 100);

        uint256 addedLock = 3 ether;
        hoax(rewarder, addedLock);
        afEth.depositRewardsAndRebalance{value: addedLock}(IAfEth.RebalanceParams(0, 0, 0, block.timestamp));
        assertEq(lockedRewards(), reward / 4 + addedLock);
    }

    function testRewardDistributionAccruesFees() public {
        {
            address user = makeAddr("user");
            uint256 value = 13.21 ether;
            hoax(user, value);
            afEth.deposit{value: value}(0, block.timestamp);
        }

        vm.prank(owner);
        uint16 fee = 0.05e4;
        afEth.setProtocolFee(fee);

        uint256 reward = 4.2 ether;
        hoax(rewarder, reward);
        afEth.depositRewardsAndRebalance{value: reward}(IAfEth.RebalanceParams(0, 0, 0, block.timestamp));

        uint256 accruedFee = reward * fee / 1e4;
        assertEq(afEth.ethOwedToOwner(), accruedFee);

        uint256 balanceBefore = owner.balance;
        vm.prank(owner);
        afEth.withdrawOwnerFunds(0, 0);
        uint256 received = owner.balance - balanceBefore;
        assertEq(received, accruedFee);
    }
}
