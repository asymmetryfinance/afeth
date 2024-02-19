// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {SimpleProxyFactory} from "../../src/utils/SimpleProxyFactory.sol";
import {VotiumStrategy} from "../../src/strategies/VotiumStrategy.sol";
import {AfEth} from "../../src/AfEth.sol";
import {MockOracle} from "../mocks/MockOracle.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/// @author philogy <https://github.com/philogy>
abstract contract BaseTest is Test {
    bytes private constant CREATE2_FACTORY_CODE =
        hex"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

    uint256 internal constant USE_MAX = 1 << 255;

    address internal immutable deployer = makeAddr("DEPLOYER");
    address internal immutable owner = makeAddr("OWNER");
    address internal immutable rewarder = makeAddr("REWARDER");

    MockOracle internal immutable baseOracle = new MockOracle();
    SimpleProxyFactory internal immutable factory = new SimpleProxyFactory();

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

        startHoax(deployer, 1 ether);
        votium = VotiumStrategy(
            payable(
                factory.deployDeterministic(
                    votiumSalt,
                    address(_votiumImplementation),
                    abi.encodeCall(VotiumStrategy.initialize, (owner, rewarder))
                )
            )
        );
        assertEq(address(votium), votiumProxyAddr, "predicted wrong votium proxy address");
        afEth = AfEth(
            payable(
                factory.deployDeterministic{value: 1 gwei}(
                    afEthSalt, address(_afEthImplementation), abi.encodeCall(AfEth.initialize, (owner, rewarder))
                )
            )
        );
        assertEq(address(afEth), afEthProxyAddr, "predicted wrong afETH proxy address");
        vm.stopPrank();
    }

    function overwriteOracle(address oracle) internal returns (MockOracle overwritten) {
        (, int256 lastPrice,,,) = AggregatorV3Interface(oracle).latestRoundData();
        vm.etch(oracle, address(baseOracle).code);
        overwritten = MockOracle(oracle);
        overwritten.update(lastPrice);
    }

    function lockedRewards() internal view returns (uint256 locked) {
        (,,,, locked) = afEth.reportValue();
    }
}
