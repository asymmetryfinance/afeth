// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Script} from "forge-std/Script.sol";
import {Test} from "forge-std/Test.sol";
import {console2 as console} from "forge-std/console2.sol";
import {ERC1967FactoryConstants} from "solady/src/utils/ERC1967FactoryConstants.sol";
import {ERC1967Factory} from "solady/src/utils/ERC1967Factory.sol";
import {VotiumStrategy} from "../src/strategies/VotiumStrategy.sol";
import {AfEth} from "../src/AfEth.sol";
import {console2 as console} from "forge-std/console2.sol";

/// @author philogy <https://github.com/philogy>
contract DeployMainnetScript is Test, Script {
    bytes32 internal constant AF_ETH_VANITY_SALT = 0x67b80ff33e5937b58b2a46870a912cb11d231efbec654a8355b49778011000c0;
    bytes32 internal constant VOTIUM_VANITY_SALT = 0x67b80ff33e5937b58b2a46870a912cb11d231efbec654a8355b43c2415010040;

    function run() public {
        ERC1967Factory factory = ERC1967Factory(ERC1967FactoryConstants.ADDRESS);

        // address OWNER = 0x263b03BbA0BbbC320928B6026f5eAAFAD9F1ddeb;
        // address REWARDER = 0xa927c81CC214cc991613cB695751Bc932F042501;
        address OWNER = vm.addr(vm.envUint("TEST1_KEY"));
        address REWARDER = OWNER;

        // TODO: Not the recommended way of loading private key.
        uint256 pk = vm.envUint("PRIV_KEY");
        address me = vm.addr(pk);

        // TESTING: Grant deployer ETH
        // vm.startBroadcast(vm.envUint("TEST0_KEY"));
        // (bool success,) = me.call{value: 9999 ether}("");
        // success;
        // vm.stopBroadcast();

        vm.startBroadcast(pk);

        address votiumImplementation;
        address afEthImplementation;
        {
            address afEthProxyAddr = factory.predictDeterministicAddress(AF_ETH_VANITY_SALT);
            address votiumProxyAddr = factory.predictDeterministicAddress(VOTIUM_VANITY_SALT);

            votiumImplementation = address(new VotiumStrategy(afEthProxyAddr));
            afEthImplementation = address(new AfEth(votiumProxyAddr));
        }
        address votium = factory.deployDeterministicAndCall(
            votiumImplementation,
            OWNER,
            VOTIUM_VANITY_SALT,
            abi.encodeCall(VotiumStrategy.initialize, (OWNER, REWARDER))
        );

        address afEth = factory.deployDeterministicAndCall{value: 1 gwei}(
            afEthImplementation, OWNER, AF_ETH_VANITY_SALT, abi.encodeCall(AfEth.initialize, (OWNER, REWARDER))
        );

        console.log("afEth successfuly deployed at %s", afEth);
        console.log("votium successfuly deployed at %s", votium);

        vm.stopBroadcast();
    }
}
