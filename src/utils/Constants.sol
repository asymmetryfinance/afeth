// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {VotiumStrategy} from "../strategies/VotiumStrategy.sol";
import {AfEth} from "../AfEth.sol";
import {AfEthRelayer} from "../AfEthRelayer.sol";

abstract contract Constants {
    AfEth internal constant AF_ETH = AfEth(payable(0x0000000016E6Cb3038203c1129c8B4aEE7af7a11));
    VotiumStrategy internal constant VOTIUM = VotiumStrategy(payable(0x00000069aBbB0B1Ad6975bcF753eEe15D318A0BF));
    AfEthRelayer internal constant RELAYER = AfEthRelayer(payable(0x0000005aC28De2cbda005a8500A9578921FDB7da));
}
