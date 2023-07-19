// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./VotiumVlcvxManager.sol";
import "../../external_interfaces/IWETH.sol";
import "../../external_interfaces/ISwapRouter.sol";

/// For private internal functions and anything not exposed via the interface
contract VotiumStrategyCore is
    Initializable,
    OwnableUpgradeable,
    ERC721Upgradeable,
    VotiumVlcvxManager
{
    // As recommended by https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
        @notice - Function to initialize values for the contracts
        @dev - This replaces the constructor for upgradeable contracts
    */
    function initialize() external initializer {
        _transferOwnership(msg.sender);
        initializeLockManager();
    }

    function buyCvx(uint256 amount) internal returns (uint256 amountOut) {
        address swapRouterAddress = 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45;
        address weth = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
        address cvx = 0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B;
        IWETH(weth).deposit{value: amount}();
        IERC20(weth).approve(swapRouterAddress, amount);
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter
            .ExactInputSingleParams({
                tokenIn: weth,
                tokenOut: cvx,
                fee: 10000,
                recipient: address(this),
                amountIn: amount,
                amountOutMinimum: 1, // TODO: fix slippage
                sqrtPriceLimitX96: 0
            });
        uint256 cvxAmountOut = ISwapRouter(swapRouterAddress).exactInputSingle(params);
        return cvxAmountOut;
    }

    receive() external payable {}
}
