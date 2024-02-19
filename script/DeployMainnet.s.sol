// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Script} from "forge-std/Script.sol";
import {Test} from "forge-std/Test.sol";
import {console2 as console} from "forge-std/console2.sol";
import {SimpleProxyFactory} from "../src/utils/SimpleProxyFactory.sol";
import {VotiumStrategy} from "../src/strategies/VotiumStrategy.sol";
import {AfEth} from "../src/AfEth.sol";
import {console2 as console} from "forge-std/console2.sol";

/// @author philogy <https://github.com/philogy>
contract DeployMainnetScript is Test, Script {
    bytes32 internal constant AF_ETH_VANITY_SALT = 0x67b80ff33e5937b58b2a46870a912cb11d231efb29d74144d35ec0000fcd3cd6;
    bytes32 internal constant VOTIUM_VANITY_SALT = 0x67b80ff33e5937b58b2a46870a912cb11d231efb29d74144d35e200008cc162e;

    function run() public {
        address OWNER = 0x263b03BbA0BbbC320928B6026f5eAAFAD9F1ddeb;
        address REWARDER = 0xa927c81CC214cc991613cB695751Bc932F042501;

        // TODO: Not the recommended way of loading private key.
        uint256 pk = vm.envUint("PRIV_KEY");
        address me = vm.addr(pk);

        vm.startBroadcast(pk);

        (bool success, bytes memory addr) =
            CREATE2_FACTORY.call(abi.encodePacked(bytes32(0), type(SimpleProxyFactory).creationCode));
        require(success, "failed to deploy factory");

        SimpleProxyFactory factory = SimpleProxyFactory(address(bytes20(addr)));

        console.log("deployer: %s", me);
        console.log("factory: %s", address(factory));
        console.log("proxy inithash: %x", uint256(factory.PROXY_INIT_HASH()));

        address votiumImplementation;
        address afEthImplementation;
        {
            address afEthProxyAddr = factory.predictDeterministicAddress(AF_ETH_VANITY_SALT);
            address votiumProxyAddr = factory.predictDeterministicAddress(VOTIUM_VANITY_SALT);

            votiumImplementation = address(new VotiumStrategy(afEthProxyAddr));
            afEthImplementation = address(new AfEth(votiumProxyAddr));
        }
        address votium = factory.deployDeterministic(
            VOTIUM_VANITY_SALT, votiumImplementation, abi.encodeCall(VotiumStrategy.initialize, (OWNER, REWARDER))
        );

        address afEth = factory.deployDeterministic{value: 1 gwei}(
            AF_ETH_VANITY_SALT, afEthImplementation, abi.encodeCall(AfEth.initialize, (OWNER, REWARDER))
        );

        console.log("afEth successfuly deployed at %s", afEth);
        console.log("votium successfuly deployed at %s", votium);

        vm.stopBroadcast();
    }
}
