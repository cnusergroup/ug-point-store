# Conversion Lambda: LibreOffice-based Office-to-PDF converter
#
# Uses shelf's pre-built base image which includes:
# - LibreOffice 7.6 (headless)
# - CJK fonts (Chinese/Japanese/Korean)
# - Node.js 20 runtime
# - AWS Lambda Runtime Interface Client
#
# Strategy: Use esbuild to bundle the handler into a single JS file,
# avoiding complex TypeScript compilation and workspace resolution.

FROM public.ecr.aws/shelf/lambda-libreoffice-base:26.2-node20-x86_64

# Install esbuild for bundling TypeScript
RUN npm install -g esbuild

# Copy source files needed for bundling
COPY packages/shared/src/ ${LAMBDA_TASK_ROOT}/packages/shared/src/
COPY packages/shared/package.json ${LAMBDA_TASK_ROOT}/packages/shared/package.json
COPY packages/backend/src/conversion/ ${LAMBDA_TASK_ROOT}/packages/backend/src/conversion/
COPY packages/backend/package.json ${LAMBDA_TASK_ROOT}/packages/backend/package.json
COPY package.json ${LAMBDA_TASK_ROOT}/package.json
COPY tsconfig.json ${LAMBDA_TASK_ROOT}/tsconfig.json

# Bundle the handler into a single file using esbuild (same approach as CDK NodejsFunction)
WORKDIR ${LAMBDA_TASK_ROOT}
RUN esbuild packages/backend/src/conversion/handler.ts \
    --bundle \
    --platform=node \
    --target=node20 \
    --outfile=index.js \
    --minify \
    --external:@aws-sdk/*

# Install only the AWS SDK packages needed at runtime
# (esbuild marks them as external since Lambda provides them)
# Actually Lambda Docker images don't include AWS SDK v3, so we need to install them
RUN npm init -y && \
    npm install --save \
    @aws-sdk/client-s3 \
    @aws-sdk/client-dynamodb \
    @aws-sdk/lib-dynamodb

# Clean up source files (only bundled index.js needed)
RUN rm -rf packages tsconfig.json

WORKDIR ${LAMBDA_TASK_ROOT}

# Handler entry point: the bundled file exports 'handler'
CMD ["index.handler"]
