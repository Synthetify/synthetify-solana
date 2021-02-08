use std::convert::TryInto;

use crate::*;

// Maybe is should be part of Asset ?
const ACCURACCY: u8 = 8;
const ORACLE_OFFSET: u8 = 4;
// USD prices have 8 decimal places
pub fn calculate_debt(assets: &Vec<Asset>, slot: u64, max_delay: u32) -> Result<u64> {
    let mut debt = 0u64;
    for asset in assets.iter() {
        if asset.last_update < slot - max_delay as u64 {
            return Err(ErrorCode::OutdatedOracle.into());
        }
        debt += (asset.price * asset.supply)
            / 10u64.pow(
                (asset.decimals + ORACLE_OFFSET - ACCURACCY)
                    .try_into()
                    .unwrap(),
            );
    }
    Ok(debt)
}
// debt need to be up to date
pub fn calculate_user_debt_in_usd(user_account: &UserAccount, debt: u64, debt_shares: u64) -> u64 {
    if debt_shares == 0 {
        return 0;
    }
    let user_debt = debt * user_account.shares / debt_shares;
    return user_debt;
}
pub fn calculate_max_user_debt_in_usd(
    collateral_asset: Asset,
    collateralization_level: u32,
    user_account: &UserAccount,
) -> u64 {
    let user_max_debt = collateral_asset.price * user_account.collateral
        / 10u64.pow(
            (collateral_asset.decimals + ORACLE_OFFSET - ACCURACCY)
                .try_into()
                .unwrap(),
        );
    return user_max_debt * 100 / collateralization_level as u64;
}

pub fn calculate_amount_mint_in_usd(mint_asset: Asset, amount: u64) -> u64 {
    let mint_amount_in_usd = mint_asset.price * amount
        / 10u64.pow(
            (mint_asset.decimals + ORACLE_OFFSET - ACCURACCY)
                .try_into()
                .unwrap(),
        );
    return mint_amount_in_usd;
}
pub fn calculate_new_shares(shares: &u64, debt: &u64, minted_amount_usd: &u64) -> u64 {
    if *shares == 0u64 {
        return 10u64.pow(8);
    }
    let new_shares = (*shares * *minted_amount_usd) / debt;

    return new_shares;
}
#[cfg(test)]
mod tests {
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
            collateral_asset,
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
        let amount_mint_in_usd = calculate_amount_mint_in_usd(mint_asset, amount);
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
}
