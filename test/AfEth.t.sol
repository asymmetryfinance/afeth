// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import {BaseTest} from "./utils/BaseTest.sol";
import {IAfEth} from "../src/interfaces/afeth/IAfEth.sol";
import {CvxEthOracleLib} from "../src/utils/CvxEthOracleLib.sol";

/// @author philogy <https://github.com/philogy>
contract AfEthTest is BaseTest {
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
    }
}
