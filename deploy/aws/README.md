# Deploy Y-Chat on AWS (personal account)

This stack creates:

- **UI:** S3 + CloudFront (HTTPS)
- **Relay:** EC2 `t3.micro` (free tier eligible) + CloudFront in front ( **WSS** )

Estimated cost after free tier: a few dollars/month (EC2 + CloudFront egress). Use **your personal** AWS account, not a work SSO profile.

## 1. Connect your personal account

Your machine currently has **invalid `default` keys** and **work SSO profiles** (`qa`, `prod`). Create a dedicated profile:

1. In the [AWS Console](https://console.aws.amazon.com/) (personal login), create an **IAM user** with programmatic access (or use root keys only for testing—not recommended long term).
2. Attach **AdministratorAccess** for a one-click deploy, or scoped S3/CloudFront/EC2/CloudFormation permissions.
3. Run:

```bash
aws configure --profile personal
# Access Key, Secret Key, region: us-east-1, output: json
aws sts get-caller-identity --profile personal
```

## 2. Deploy

From the repo root:

```bash
chmod +x deploy/aws/deploy.sh
AWS_PROFILE=personal AWS_REGION=us-east-1 ./deploy/aws/deploy.sh
```

Optional SSH key on the relay instance:

```bash
EC2_KEY_NAME=my-key AWS_PROFILE=personal ./deploy/aws/deploy.sh
```

Without a key, use **SSM Session Manager** on the instance (IAM role is included).

## 3. After deploy

The script prints:

- **UiUrl** — open in the browser
- Updates `public/config.json` with relay URLs and uploads `public/` to S3

First boot on EC2 can take **3–5 minutes** (clone repo, `npm install`, start service). If the UI says relay unreachable, wait and refresh.

## 4. Update later

Re-run `./deploy/aws/deploy.sh` after UI changes. For relay code changes, either re-run the stack (recreates instance) or SSH/SSM into the box and `git pull && npm install && systemctl restart y-chat`.

## 5. Tear down

```bash
AWS_PROFILE=personal aws cloudformation delete-stack --stack-name ychat --region us-east-1
```

Empty the S3 bucket first if delete-stack fails on the bucket.
