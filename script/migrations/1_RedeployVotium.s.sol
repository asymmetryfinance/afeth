// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Script} from "forge-std/Script.sol";
import {Test} from "forge-std/Test.sol";
import {console2 as console} from "forge-std/console2.sol";
import {Constants} from "../../src/utils/Constants.sol";
import {VotiumStrategy} from "../../src/strategies/VotiumStrategy.sol";
import {console2 as console} from "forge-std/console2.sol";
import {MockSafe} from "../../test/mocks/MockSafe.sol";

/// @author philogy <https://github.com/philogy>
contract Migration is Test, Script, Constants {
    function run() public {
        vm.startBroadcast();

        _migrate();

        vm.stopBroadcast();
    }

    function testMigration() public {
        address votium = _migrate();

        address owner = AF_ETH.owner();
        vm.etch(owner, type(MockSafe).runtimeCode);

        MockSafe safe = MockSafe(payable(owner));
        safe.exec(address(VOTIUM), 0, abi.encodeCall(VOTIUM.upgradeToAndCall, (votium, "")));

        address bad = makeAddr("bad");
        vm.expectRevert(abi.encodeWithSignature("InvalidInitialization()"));
        VOTIUM.initialize(bad, bad);
    }

    function _migrate() internal returns (address votium) {
        votium = address(new VotiumStrategy({afEth: address(AF_ETH)}));

        console.log("redeployed votium to: %s", votium);
    }
}
