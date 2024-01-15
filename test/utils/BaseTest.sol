// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {ERC1967Factory} from "solady/src/utils/ERC1967Factory.sol";
import {VotiumStrategy} from "../../src/strategies/VotiumStrategy.sol";
import {AfEth} from "../../src/AfEth.sol";

/// @author philogy <https://github.com/philogy>
abstract contract BaseTest is Test {
    address internal immutable deployer = makeAddr("DEPLOYER");
    address internal immutable owner = makeAddr("OWNER");
    address internal immutable rewarder = makeAddr("REWARDER");

    ERC1967Factory internal immutable factory = new ERC1967Factory();

    VotiumStrategy private _votiumImplementation;
    VotiumStrategy internal votium;

    AfEth private _afEthImplementation;
    AfEth internal afEth;

    function setUp() public virtual {
        bytes32 votiumSalt = bytes32(abi.encodePacked(deployer, uint96(0x01)));
        bytes32 afEthSalt = bytes32(abi.encodePacked(deployer, uint96(0x02)));

        address votiumProxyAddr = factory.predictDeterministicAddress(votiumSalt);
        address afEthProxyAddr = factory.predictDeterministicAddress(afEthSalt);
        assertTrue(votiumProxyAddr != afEthProxyAddr, "Duplicate address");

        _votiumImplementation = new VotiumStrategy(afEthProxyAddr);
        _afEthImplementation = new AfEth(votiumProxyAddr);

        vm.startPrank(deployer);
        votium = VotiumStrategy(
            payable(
                factory.deployDeterministicAndCall(
                    address(_votiumImplementation),
                    owner,
                    votiumSalt,
                    abi.encodeCall(VotiumStrategy.initialize, (owner, rewarder))
                )
            )
        );
        afEth = AfEth(
            payable(
                factory.deployDeterministicAndCall(
                    address(_afEthImplementation), owner, afEthSalt, abi.encodeCall(AfEth.initialize, (owner))
                )
            )
        );
        vm.stopPrank();
    }
}
