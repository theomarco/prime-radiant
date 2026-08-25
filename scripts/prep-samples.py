"""Turn raw public datasets into the one-file form the Explore page expects.

Every bundled sample is a single table where the target column is filled in for
most rows and blank for the rest. The blanks are what Seldon is asked to fill.

Three things happen here, and only the first is cosmetic:

1. Columns that are constant, or that are plainly row identifiers, are dropped.
   The API would ignore them anyway; removing them keeps the column picker short.
2. Columns that leak the answer are dropped. A demo that scores well because a
   column restates the target is worse than no demo, so each drop below names
   why it leaks.
3. Sensitive attributes are dropped where the prediction is about a person. The
   interpretability panel renders whatever it is given, and a public page should
   not display a bar attributing attrition risk to someone's gender.

Run: python3 scripts/prep-samples.py
"""

import pathlib
import numpy as np
import pandas as pd

OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "samples"
KAGGLE = pathlib.Path("/Users/tma/workspaces/neuralk/kaggle/_overnight")
TFM = pathlib.Path("/Users/tma/workspaces/neuralk/tfm-agent/data/kaggle")
HOLDOUT = 0.20
SEED = 20260824


def blank_target(df: pd.DataFrame, target: str) -> pd.DataFrame:
    """Blank a fifth of the target at random. Those rows become the question."""
    df = df.copy()
    df[target] = df[target].astype("object")
    rng = np.random.default_rng(SEED)
    idx = rng.choice(len(df), size=int(len(df) * HOLDOUT), replace=False)
    df.iloc[idx, df.columns.get_loc(target)] = None
    return df


def emit(df: pd.DataFrame, target: str, name: str) -> None:
    df = blank_target(df, target)
    path = OUT / name
    if path.suffix == ".parquet":
        df.to_parquet(path, index=False, compression="zstd")
    else:
        df.to_csv(path, index=False)
    filled = df[target].notna().sum()
    size = path.stat().st_size / 1_048_576
    print(
        f"{name:28} {len(df):>7,} rows x {df.shape[1]:>2} cols  "
        f"{filled:,} labeled, {len(df) - filled:,} to predict  {size:.1f} MB"
    )


# --------------------------------------------------------- HR / attrition ---
df = pd.read_csv(KAGGLE / "ibm_attrition/raw/WA_Fn-UseC_-HR-Employee-Attrition.csv")
df = df.drop(
    columns=[
        "EmployeeCount", "StandardHours", "Over18",  # single-valued
        "EmployeeNumber",                            # row identifier
        "Gender", "MaritalStatus",                   # sensitive; see note 3 above
    ]
)
emit(df, "Attrition", "hr-attrition.csv")

# ------------------------------------------------------ Sales / lead score ---
df = pd.read_csv(KAGGLE / "lead_scoring/raw/Lead Scoring.csv")
df = df.drop(
    columns=[
        "Prospect ID", "Lead Number",
        # Written by a rep who already knew how it ended: "Will revert after
        # reading the email" is 2,007 conversions out of 2,007.
        "Tags", "Lead Quality",
        # Somebody else's model score. Learning to copy it proves nothing.
        "Asymmetrique Activity Index", "Asymmetrique Profile Index",
        "Asymmetrique Activity Score", "Asymmetrique Profile Score",
        # Near-constant "No" flags.
        "Magazine", "Newspaper Article", "X Education Forums", "Newspaper",
        "Search", "Digital Advertisement", "Through Recommendations",
        "Receive More Updates About Our Courses",
        "Update me on Supply Chain Content", "Get updates on DM Content",
        "I agree to pay the amount through cheque",
    ]
)
# "Select" is this form's placeholder for an unanswered dropdown, not an answer.
df = df.replace("Select", np.nan)
emit(df, "Converted", "lead-scoring.csv")

# ------------------------------------------------ Travel / cancellations ---
df = pd.read_csv(KAGGLE / "hotel_booking/raw/hotel_bookings.csv", low_memory=False)
df = df.drop(
    columns=[
        # reservation_status is the target restated: Check-Out maps to 0, and
        # Canceled and No-Show map to 1, with no exceptions in 119,390 rows.
        "reservation_status", "reservation_status_date",
        "company", "agent",  # booking-system ids, mostly empty
    ]
)
emit(df, "is_canceled", "hotel-cancellations.parquet")

# --------------------------------------------------- Logistics / delivery ---
df = pd.read_csv("/tmp/ship/Train.csv")
df = df.drop(columns=["ID", "Gender"])
# The raw name reads backwards: 1 means the parcel did NOT arrive on time.
df = df.rename(columns={"Reached.on.Time_Y.N": "arrived_late"})
emit(df, "arrived_late", "late-delivery.csv")

# --------------------------------------------------------- Payments / fraud ---
# Shipped whole rather than subsampled. Bundled samples are pre-processed, so
# the browser-side row cap does not apply to them, and the real class balance
# is the interesting part: cutting to 40,000 rows left only 55 frauds to learn
# from. Parquet because 31 float columns over 284,807 rows is ~63 MB as CSV,
# which is both over the upload ceiling and a rude download for a demo.
df = pd.concat(
    [
        pd.read_csv(TFM / "kaggle-creditcard-fraud_train.csv"),
        pd.read_csv(TFM / "kaggle-creditcard-fraud_sealed.csv"),
    ],
    ignore_index=True,
).sort_values("Time", ignore_index=True)
emit(df, "Class", "card-fraud.parquet")
