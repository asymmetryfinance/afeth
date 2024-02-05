// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Script} from "forge-std/Script.sol";
import {Test} from "forge-std/Test.sol";
import {console2 as console} from "forge-std/console2.sol";
import {AfEth} from "../src/AfEth.sol";
import {console2 as console} from "forge-std/console2.sol";

/// @author philogy <https://github.com/philogy>
contract SetupQuickScript is Test, Script {
    AfEth internal constant afeth = AfEth(payable(0x000000007896ae1058CB6BbD9D472c2C9aaDe11e));

    function run() public {
        uint256 pk = vm.envUint("TEST1_KEY");
        address me = vm.addr(pk);

        vm.startBroadcast(pk);

        afeth.deposit{value: 30 ether}(0, block.timestamp + 240 weeks);
        afeth.depositForQuickActions{value: 20 ether}(1 << 255);
        afeth.configureQuickActions(0.01e4, 0.01e4, 3 ether, 3e18);

        vm.stopBroadcast();
    }
}
