"""Check whether this machine can actually call Textract.

Run it whenever extraction fails, to tell apart the three things that look
identical from the UI: credentials not loading, the account not being
subscribed to the service, and the IAM user missing permissions.

    python scripts/check_aws.py

Costs one AnalyzeDocument page (~$0.015) when it gets far enough to try -- the
same call the extractor makes, so a pass here means uploads will work.
"""
import io
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def fail(message, fix):
    print(f"\n  FAILED  {message}\n  FIX     {fix}\n")
    sys.exit(1)


def main():
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")

    region = os.getenv("AWS_REGION", "us-east-1")
    key_id = os.getenv("AWS_ACCESS_KEY_ID") or ""
    print(f"region      {region}")
    print(f"access key  {'...' + key_id[-4:] if key_id else '<NOT SET>'}")

    if not key_id:
        fail("no AWS_ACCESS_KEY_ID in referral-intake/.env",
             "copy .env.example to .env and fill in your keys")

    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError

    # 1. Do the credentials resolve at all?
    try:
        identity = boto3.client("sts", region_name=region).get_caller_identity()
        print(f"identity    {identity['Arn']}")
    except NoCredentialsError:
        fail("boto3 found no credentials",
             "check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env")
    except ClientError as e:
        fail(f"STS rejected the credentials: {e.response['Error']['Code']}",
             "the access key is wrong, disabled, or deleted -- make a new one in IAM")

    # 2. Can we actually call the service?
    from PIL import Image, ImageDraw
    image = Image.new("L", (600, 200), color=255)
    ImageDraw.Draw(image).text((40, 80), "PATIENT NAME: TEST 123", fill=0)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    # Deliberately AnalyzeDocument with a query, not the cheaper
    # DetectDocumentText: this has to exercise the same call the extractor
    # makes, or a policy that grants one and not the other reads as a failure
    # when the app would have worked fine.
    try:
        response = boto3.client("textract", region_name=region).analyze_document(
            Document={"Bytes": buffer.getvalue()},
            FeatureTypes=["QUERIES"],
            QueriesConfig={"Queries": [{"Text": "What is the patient name?", "Alias": "probe"}]},
        )
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code == "SubscriptionRequiredException":
            fail("the AWS account is not activated for Textract",
                 "finish account setup at console.aws.amazon.com/billing/home#/account "
                 "(payment method + identity verification), then re-run this. "
                 "Activation is usually minutes but AWS allows up to 24 hours.")
        if code in ("AccessDeniedException", "UnrecognizedClientException"):
            fail(f"the IAM user cannot call Textract: {code}",
                 "attach a policy allowing textract:AnalyzeDocument to this user")
        fail(f"Textract returned {code}: {e.response['Error']['Message']}",
             "see the message above")

    pages = response["DocumentMetadata"]["Pages"]
    lines = [b["Text"] for b in response["Blocks"] if b["BlockType"] == "LINE"]
    print(f"textract    OK -- {pages} page, read {lines}")
    print("\n  PASSED  extraction will work; upload a fax in the UI\n")


if __name__ == "__main__":
    main()
