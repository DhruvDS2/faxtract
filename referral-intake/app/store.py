"""Persistence for referral records, reviewer corrections and RIS send attempts.

OWNED BY LANE A. Declare tables on app.db.Base here; app.db.init_db() imports
this module so create_all picks them up. Shapes returned to the API are the
frozen models in app.contracts (ReferralRecord, ReferralSummary, RisOrderRow)
and app.models.Correction.
"""
