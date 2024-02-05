// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {ERC1967Factory} from "solady/src/utils/ERC1967Factory.sol";
import {VotiumStrategy} from "../../src/strategies/VotiumStrategy.sol";
import {AfEth} from "../../src/AfEth.sol";
import {MockOracle} from "../mocks/MockOracle.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/// @author philogy <https://github.com/philogy>
abstract contract BaseTest is Test {
    uint256 internal constant USE_MAX = 1 << 255;

    address internal immutable deployer = makeAddr("DEPLOYER");
    address internal immutable owner = makeAddr("OWNER");
    address internal immutable rewarder = makeAddr("REWARDER");

    MockOracle internal immutable baseOracle = new MockOracle();
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

        startHoax(deployer, 1 ether);
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
                factory.deployDeterministicAndCall{value: 1 gwei}(
                    address(_afEthImplementation), owner, afEthSalt, abi.encodeCall(AfEth.initialize, (owner, rewarder))
                )
            )
        );
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
