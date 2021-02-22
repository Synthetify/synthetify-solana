use std::convert::TryInto;

use crate::*;

// Maybe is should be part of Asset ?
const ACCURACCY: u8 = 8;
const ORACLE_OFFSET: u8 = 4;

// Switch to u128? Reduce decimals for tokens ?
// At least rust will error during overflows checkmate Solidity

// USD prices have 8 decimal places
pub fn check_feed_update(
    assets: &Vec<Asset>,
    indexA: usize,
    indexB: usize,
    max_delay: u32,
    slot: u64,
) -> Result<()> {
    // Check assetA
    if !assets[indexA].feed_address.eq(&Pubkey::default()) {
        msg!("checkA {}", slot);
        if (assets[indexA].last_update + max_delay as u64) < slot {
            return Err(ErrorCode::OutdatedOracle.into());
        }
    }
    // Check assetB
    if !assets[indexB].feed_address.eq(&Pubkey::default()) {
        msg!("checkB {}", slot);
        if (assets[indexB].last_update + max_delay as u64) < slot {
            return Err(ErrorCode::OutdatedOracle.into());
        }
    }
    return Ok(());
}
pub fn calculate_debt(assets: &Vec<Asset>, slot: u64, max_delay: u32) -> Result<u64> {
    let mut debt = 0u128;
    for asset in assets.iter() {
        if (asset.last_update + max_delay as u64) < slot {
            msg!("last update {}", asset.last_update);
            msg!("slot {}", slot);
            if asset.feed_address.eq(&Pubkey::default()) {
            } else {
                return Err(ErrorCode::OutdatedOracle.into());
            }
        }
        debt += (asset.price as u128 * asset.supply as u128)
            / 10u128.pow(
                (asset.decimals + ORACLE_OFFSET - ACCURACCY)
                    .try_into()
                    .unwrap(),
            );
    }
    Ok(debt as u64)
}
// debt need to be up to date
pub fn calculate_user_debt_in_usd(user_account: &UserAccount, debt: u64, debt_shares: u64) -> u64 {
    if debt_shares == 0 {
        return 0;
    }
    let user_debt = debt as u128 * user_account.shares as u128 / debt_shares as u128;
    return user_debt as u64;
}
pub fn calculate_max_user_debt_in_usd(
    collateral_asset: &Asset,
    collateralization_level: u32,
    user_account: &UserAccount,
) -> u64 {
    let user_max_debt = collateral_asset.price as u128 * user_account.collateral as u128
        / 10u128.pow(
            (collateral_asset.decimals + ORACLE_OFFSET - ACCURACCY)
                .try_into()
                .unwrap(),
        );
    return (user_max_debt * 100 / collateralization_level as u128)
        .try_into()
        .unwrap();
}
pub fn calculate_max_withdraw_in_usd(
    max_user_debt_in_usd: &u64,
    user_debt_in_usd: &u64,
    collateralization_level: &u32,
) -> u64 {
    if max_user_debt_in_usd < user_debt_in_usd {
        return 0;
    }
    return ((max_user_debt_in_usd - user_debt_in_usd) * *collateralization_level as u64) / 100;
}
pub fn calculate_amount_mint_in_usd(mint_asset: &Asset, amount: u64) -> u64 {
    let mint_amount_in_usd = mint_asset.price as u128 * amount as u128
        / 10u128.pow((mint_asset.decimals + ORACLE_OFFSET - ACCURACCY).into());
    return mint_amount_in_usd as u64;
}
pub fn calculate_new_shares(shares: &u64, debt: &u64, minted_amount_usd: &u64) -> u64 {
    if *shares == 0u64 {
        return 10u64.pow(8);
    }
    let new_shares = (*shares as u128 * *minted_amount_usd as u128) / *debt as u128;

    return new_shares as u64;
}
pub fn calculate_burned_shares(
    asset: &Asset,
    user_debt: &u64,
    user_shares: &u64,
    amount: &u64,
) -> u64 {
    let burn_amount_in_usd = asset.price as u128 * *amount as u128
        / 10u128.pow((asset.decimals + ORACLE_OFFSET - ACCURACCY).into());
    let burned_shares = burn_amount_in_usd * *user_shares as u128 / *user_debt as u128;
    return burned_shares as u64;
}
pub fn calculate_max_burned_in_token(asset: &Asset, user_debt: &u64) -> u64 {
    let burned_amount_token =
        *user_debt as u128 * 10u128.pow(ORACLE_OFFSET.into()) / asset.price as u128;
    return burned_amount_token as u64;
}

pub fn calculate_swap_out_amount(
    asset_in: &Asset,
    asset_for: &Asset,
    amount: &u64,
    fee: &u8, // in range from 0-99 | 30/10000 => 0.3% fee
) -> u64 {
    // Assume same amount of decimals
    // TODO: Fix that for future
    let amount_before_fee = asset_in.price as u128 * *amount as u128 / asset_for.price as u128;
    let amount = amount_before_fee - (amount_before_fee * *fee as u128 / 10000);
    return amount as u64;
}
#[cfg(test)]
mod tests {
    use std::ops::Div;

    use super::*;
    #[test]
    fn test_calculate_debt_success() {
        let slot = 100;
        let accuracy = 8;
        let asset_1 = Asset {
            // oracle offset set as 4
            price: 10 * 10u64.pow(ORACLE_OFFSET.into()),
            supply: 100 * 10u64.pow(8),
            last_update: slot - 10,
            decimals: 8,
            ..Default::default()
        };
        // debt 1000
        let asset_2 = Asset {
            price: 12 * 10u64.pow(ORACLE_OFFSET.into()),
            supply: 200 * 10u64.pow(8),
            last_update: 100,
            decimals: 8,
            ..Default::default()
        };
        // debt 2400
        let assets: Vec<Asset> = vec![asset_1, asset_2];
        let result = calculate_debt(&assets, slot, 100);
        match result {
            Ok(debt) => assert_eq!(debt, 3400 * 10u64.pow(accuracy)),
            Err(_) => assert!(false, "Shouldn't check"),
        }
    }
    #[test]
    fn test_calculate_debt_error() {
        let slot = 100;
        let asset_1 = Asset {
            price: 10 * 10u64.pow(ORACLE_OFFSET.into()),
            supply: 100 * 10u64.pow(8),
            last_update: slot - 10,
            decimals: 8,
            feed_address: Pubkey::new_unique(),
            ..Default::default()
        };
        // debt 1000
        let asset_2 = Asset {
            price: 12 * 10u64.pow(ORACLE_OFFSET.into()),
            supply: 200 * 10u64.pow(8),
            last_update: 100,
            decimals: 8,
            ..Default::default()
        };
        // debt 2400
        let assets: Vec<Asset> = vec![asset_1, asset_2];
        let result = calculate_debt(&assets, slot, 0);
        // println!("{:?}", result);
        assert!(result.is_err());
    }
    #[test]
    fn test_calculate_user_debt_in_usd() {
        let debt = 1000;
        let debt_shares = 1000;
        // one share = one debt
        let user_account = UserAccount {
            collateral: 100,
            shares: 10,
            owner: Pubkey::default(),
        };
        let user_debt = calculate_user_debt_in_usd(&user_account, debt, debt_shares);
        assert_eq!(user_debt, debt * user_account.shares / debt_shares);
        // Zero shares
        let user_account_zero_shares = UserAccount {
            collateral: 100,
            shares: 0,
            owner: Pubkey::default(),
        };
        let user_debt_zero_shares =
            calculate_user_debt_in_usd(&user_account_zero_shares, debt, debt_shares);
        assert_eq!(user_debt_zero_shares, 0);
    }
    #[test]
    fn test_calculate_max_user_debt_in_usd() {
        let collateralization_level = 500;
        // one share = one debt
        let user_account = UserAccount {
            collateral: 10 * 10u64.pow(8),
            shares: 10,
            owner: Pubkey::default(),
        };
        let collateral_asset = Asset {
            price: 12 * 10u64.pow(ORACLE_OFFSET.into()),
            last_update: 100,
            decimals: 8,
            ..Default::default()
        };
        // 10 tokens per 12 $ each => 120
        // collateralization_level 1/5 means 120*1/5 => 24 * decimals
        let user_max_debt = calculate_max_user_debt_in_usd(
            &collateral_asset,
            collateralization_level,
            &user_account,
        );
        assert_eq!(user_max_debt, 24 * 10u64.pow(8));
    }
    #[test]
    fn test_calculate_amount_mint_in_usd() {
        let amount = 10 * 10u64.pow(8);
        let mint_asset = Asset {
            price: 12 * 10u64.pow(ORACLE_OFFSET.into()),
            last_update: 100,
            decimals: 8,
            ..Default::default()
        };
        // 10 tokens per 12 $ each => 120 * decimals
        let amount_mint_in_usd = calculate_amount_mint_in_usd(&mint_asset, amount);
        assert_eq!(amount_mint_in_usd, 120 * 10u64.pow(8));
    }
    #[test]
    fn test_calculate_new_shares_initial() {
        let shares = 0;
        let new_debt = 100;
        let minted_amount_usd = 100;

        let new_shares_initial = calculate_new_shares(&shares, &new_debt, &minted_amount_usd);
        assert_eq!(new_shares_initial, 10u64.pow(8));
    }
    #[test]
    fn test_calculate_new_shares_next() {
        let shares = 10u64.pow(8);
        let debt = 5 * 10u64.pow(8);
        let minted_amount_usd = 5 * 10u64.pow(8);

        let new_shares_initial = calculate_new_shares(&shares, &debt, &minted_amount_usd);
        assert_eq!(new_shares_initial, 10u64.pow(8));

        let shares = 10u64.pow(8);
        let debt = 15 * 10u64.pow(8);
        let minted_amount_usd = 5 * 10u64.pow(8);

        let new_shares_initial = calculate_new_shares(&shares, &debt, &minted_amount_usd);
        assert_eq!(new_shares_initial, 10u64.pow(8) / 3);
    }
    #[test]
    fn test_calculate_max_withdraw_in_usd() {
        let max_user_debt_in_usd = 20;
        let user_debt_in_usd = 10;
        let collateralization_level = 500;

        let max_withdraw_in_usd = calculate_max_withdraw_in_usd(
            &max_user_debt_in_usd,
            &user_debt_in_usd,
            &collateralization_level,
        );
        assert_eq!(max_withdraw_in_usd, 50);
    }
    #[test]
    fn test_calculate_burned_shares() {
        let user_debt_in_usd = 100 * 10u64.pow(ACCURACCY.into());
        let asset = Asset {
            price: 1 * 10u64.pow(ORACLE_OFFSET.into()),
            last_update: 100,
            decimals: 8,
            ..Default::default()
        };
        let user_shares = 10u64.pow(8u32);
        let amount = 50 * 10u64.pow(asset.decimals as u32);
        // each token cost 1 usd we burn 50% so we should burn 50% shares
        let burned_shares =
            calculate_burned_shares(&asset, &user_debt_in_usd, &user_shares, &amount);
        assert_eq!(burned_shares, user_shares.div(2u64));
    }
    #[test]
    fn test_calculate_max_burned_in_token() {
        let user_debt_in_usd = 100 * 10u64.pow(ACCURACCY.into());
        let asset = Asset {
            price: 2 * 10u64.pow(ORACLE_OFFSET.into()),
            last_update: 100,
            decimals: 8,
            ..Default::default()
        };
        // Our debt = 100 usd each token cost 2 so we burn 50 tokens
        let amount_to_burn = calculate_max_burned_in_token(&asset, &user_debt_in_usd);
        assert_eq!(amount_to_burn, 50 * 10u64.pow(asset.decimals.into()));
    }
    #[test]
    fn test_calculate_swap_out_amount() {
        let amount_in = 1000 * 10u64.pow(ACCURACCY.into());
        let fee = 30u8;
        let asset_in = Asset {
            price: 1 * 10u64.pow(ORACLE_OFFSET.into()),
            last_update: 100,
            decimals: 8,
            ..Default::default()
        };
        let asset_for = Asset {
            price: 1 * 10u64.pow(ORACLE_OFFSET.into()),
            last_update: 100,
            decimals: 8,
            ..Default::default()
        };
        let asset_for_2 = Asset {
            price: 2 * 10u64.pow(ORACLE_OFFSET.into()),
            last_update: 100,
            decimals: 8,
            ..Default::default()
        };
        // Test on tokens with same price
        let amount = calculate_swap_out_amount(&asset_in, &asset_for, &amount_in, &fee);
        assert_eq!(amount, 997 * 10u64.pow(ACCURACCY.into()));
        // Test on tokens with different price
        let amount = calculate_swap_out_amount(&asset_in, &asset_for_2, &amount_in, &fee);
        assert_eq!(amount, 4985 * 10u64.pow(ACCURACCY.into()) / 10);
    }
}
