#!/bin/bash
echo "Creating SQS queues..."

awslocal sqs create-queue --queue-name reservation-confirm-dlq

awslocal sqs create-queue --queue-name reservation-confirm \
  --attributes '{
    "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:reservation-confirm-dlq\",\"maxReceiveCount\":\"3\"}",
    "VisibilityTimeout": "30"
  }'

echo "SQS queues created:"
awslocal sqs list-queues
