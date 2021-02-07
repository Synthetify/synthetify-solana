use std::convert::TryInto;

use crate::*;

pub fn calculate_debt(assets: Vec<Asset>, slot: u64, max_delay: u32) -> Result<u64> {
    let mut debt = 0u64;
    // Maybe is should be part of Asset ?
    let oracle_offset = 4;
    let accuracy = 8;
    for asset in assets.iter() {
        if asset.last_update < slot - max_delay as u64 {
            return Err(ErrorCode::OutdatedOracle.into());
        }
        debt += (asset.price * asset.supply * 10u64.pow(accuracy))
            / 10u64.pow((asset.decimals + oracle_offset).try_into().unwrap());
    }
    Ok(debt)
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
            price: 10 * 10u64.pow(4),
            supply: 100,
            last_update: slot - 10,
            decimals: 0,
            ..Default::default()
        };
        // debt 1000
        let asset_2 = Asset {
            price: 12 * 10u64.pow(4),
            supply: 200,
            last_update: 100,
            decimals: 0,
            ..Default::default()
        };
        // debt 2400
        let assets: Vec<Asset> = vec![asset_1, asset_2];
        let result = calculate_debt(assets, slot, 100);
        match result {
            Ok(debt) => assert_eq!(debt, 3400 * 10u64.pow(accuracy)),
            Err(_) => assert!(false, "Shouldn't check"),
        }
    }
    #[test]
    fn test_calculate_debt_error() {
        let slot = 100;
        let asset_1 = Asset {
            price: 10 * 10u64.pow(4),
            supply: 100,
            last_update: slot - 10,
            ..Default::default()
        };
        // debt 1000
        let asset_2 = Asset {
            price: 12 * 10u64.pow(4),
            supply: 200,
            last_update: 100,
            ..Default::default()
        };
        // debt 2400
        let assets: Vec<Asset> = vec![asset_1, asset_2];
        let result = calculate_debt(assets, slot, 0);
        // println!("{:?}", result);
        assert!(result.is_err());
    }
}
