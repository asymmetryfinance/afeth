// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";

contract CounterTest is Test {
    function test_Increment() public {
        uint256 x = 3;
        assertEq(x, 1 + 2);
    }
}
