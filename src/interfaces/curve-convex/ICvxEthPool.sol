// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

ICvxEthPool constant CVX_ETH_POOL = ICvxEthPool(payable(0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4));

uint256 constant ETH_COIN_INDEX = 0;
uint256 constant CVX_COIN_INDEX = 1;

interface ICvxEthPool {
    event AddLiquidity(address indexed provider, uint256[2] token_amounts, uint256 fee, uint256 token_supply);
    event ClaimAdminFee(address indexed admin, uint256 tokens);
    event CommitNewAdmin(uint256 indexed deadline, address indexed admin);
    event CommitNewParameters(
        uint256 indexed deadline,
        uint256 admin_fee,
        uint256 mid_fee,
        uint256 out_fee,
        uint256 fee_gamma,
        uint256 allowed_extra_profit,
        uint256 adjustment_step,
        uint256 ma_half_time
    );
    event NewAdmin(address indexed admin);
    event NewParameters(
        uint256 admin_fee,
        uint256 mid_fee,
        uint256 out_fee,
        uint256 fee_gamma,
        uint256 allowed_extra_profit,
        uint256 adjustment_step,
        uint256 ma_half_time
    );
    event RampAgamma(
        uint256 initial_A,
        uint256 future_A,
        uint256 initial_gamma,
        uint256 future_gamma,
        uint256 initial_time,
        uint256 future_time
    );
    event RemoveLiquidity(address indexed provider, uint256[2] token_amounts, uint256 token_supply);
    event RemoveLiquidityOne(address indexed provider, uint256 token_amount, uint256 coin_index, uint256 coin_amount);
    event StopRampA(uint256 current_A, uint256 current_gamma, uint256 time);
    event TokenExchange(
        address indexed buyer, uint256 sold_id, uint256 tokens_sold, uint256 bought_id, uint256 tokens_bought
    );

    fallback() external payable;
    receive() external payable;

    function A() external view returns (uint256);
    function D() external view returns (uint256);
    function add_liquidity(uint256[2] memory amounts, uint256 min_mint_amount) external payable returns (uint256);
    function add_liquidity(uint256[2] memory amounts, uint256 min_mint_amount, bool use_eth)
        external
        payable
        returns (uint256);
    function adjustment_step() external view returns (uint256);
    function admin_actions_deadline() external view returns (uint256);
    function admin_fee() external view returns (uint256);
    function admin_fee_receiver() external view returns (address);
    function allowed_extra_profit() external view returns (uint256);
    function apply_new_parameters() external;
    function apply_transfer_ownership() external;
    function balances(uint256 arg0) external view returns (uint256);
    function calc_token_amount(uint256[2] memory amounts) external view returns (uint256);
    function calc_withdraw_one_coin(uint256 token_amount, uint256 i) external view returns (uint256);
    function claim_admin_fees() external;
    function coins(uint256 i) external view returns (address);
    function commit_new_parameters(
        uint256 _new_mid_fee,
        uint256 _new_out_fee,
        uint256 _new_admin_fee,
        uint256 _new_fee_gamma,
        uint256 _new_allowed_extra_profit,
        uint256 _new_adjustment_step,
        uint256 _new_ma_half_time
    ) external;
    function commit_transfer_ownership(address _owner) external;
    function exchange(uint256 i, uint256 j, uint256 dx, uint256 min_dy) external payable returns (uint256);
    function exchange(uint256 i, uint256 j, uint256 dx, uint256 min_dy, bool use_eth)
        external
        payable
        returns (uint256);
    function exchange_underlying(uint256 i, uint256 j, uint256 dx, uint256 min_dy) external payable returns (uint256);
    function fee() external view returns (uint256);
    function fee_gamma() external view returns (uint256);
    function future_A_gamma() external view returns (uint256);
    function future_A_gamma_time() external view returns (uint256);
    function future_adjustment_step() external view returns (uint256);
    function future_admin_fee() external view returns (uint256);
    function future_allowed_extra_profit() external view returns (uint256);
    function future_fee_gamma() external view returns (uint256);
    function future_ma_half_time() external view returns (uint256);
    function future_mid_fee() external view returns (uint256);
    function future_out_fee() external view returns (uint256);
    function future_owner() external view returns (address);
    function gamma() external view returns (uint256);
    function get_dy(uint256 i, uint256 j, uint256 dx) external view returns (uint256);
    function get_virtual_price() external view returns (uint256);
    function initial_A_gamma() external view returns (uint256);
    function initial_A_gamma_time() external view returns (uint256);
    function is_killed() external view returns (bool);
    function kill_deadline() external view returns (uint256);
    function kill_me() external;
    function last_prices() external view returns (uint256);
    function last_prices_timestamp() external view returns (uint256);
    function lp_price() external view returns (uint256);
    function ma_half_time() external view returns (uint256);
    function mid_fee() external view returns (uint256);
    function out_fee() external view returns (uint256);
    function owner() external view returns (address);
    function price_oracle() external view returns (uint256);
    function price_scale() external view returns (uint256);
    function ramp_A_gamma(uint256 future_A, uint256 future_gamma, uint256 future_time) external;
    function remove_liquidity(uint256 _amount, uint256[2] memory min_amounts) external;
    function remove_liquidity(uint256 _amount, uint256[2] memory min_amounts, bool use_eth) external;
    function remove_liquidity_one_coin(uint256 token_amount, uint256 i, uint256 min_amount)
        external
        returns (uint256);
    function remove_liquidity_one_coin(uint256 token_amount, uint256 i, uint256 min_amount, bool use_eth)
        external
        returns (uint256);
    function revert_new_parameters() external;
    function revert_transfer_ownership() external;
    function set_admin_fee_receiver(address _admin_fee_receiver) external;
    function stop_ramp_A_gamma() external;
    function token() external view returns (address);
    function transfer_ownership_deadline() external view returns (uint256);
    function unkill_me() external;
    function virtual_price() external view returns (uint256);
    function xcp_profit() external view returns (uint256);
    function xcp_profit_a() external view returns (uint256);
}
