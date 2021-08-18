import * as cdk from '@aws-cdk/core';
import {
  UserPool,
  VerificationEmailStyle,
  UserPoolClient,
  AccountRecovery,
} from '@aws-cdk/aws-cognito';
import {
  GraphqlApi,
  AuthorizationType,
  FieldLogLevel,
  MappingTemplate,
  Schema,
} from '@aws-cdk/aws-appsync';
import { AttributeType, BillingMode, Table } from '@aws-cdk/aws-dynamodb';
import {
  Role,
  ServicePrincipal,
  Effect,
  PolicyStatement,
} from '@aws-cdk/aws-iam';

export class AppsyncCdkChatAppStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create authentication services
    const userPool = new UserPool(this, 'realtime-chat-app', {
      selfSignUpEnabled: true,
      accountRecovery: AccountRecovery.PHONE_AND_EMAIL,
      userVerification: {
        emailStyle: VerificationEmailStyle.CODE,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
    });

    const userPoolClient = new UserPoolClient(this, 'UserPoolClient', {
      userPool,
    });

    // CfnOutput is a way to print out useful values that you will need,
    // in our case we will be using these values in the client - side application
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
    });

    // Create DynamoDB resources
    const messageTable = new Table(this, 'ChatMessageTable', {
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'id',
        type: AttributeType.STRING,
      },
    });

    const roomTable = new Table(this, 'ChatRoomTable', {
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'id',
        type: AttributeType.STRING,
      },
    });

    // enable query message by roomId by adding Global Secondary Index
    messageTable.addGlobalSecondaryIndex({
      indexName: 'message-by-room-id',
      partitionKey: {
        name: 'roomId',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: AttributeType.STRING,
      },
    });

    // Give permission to DynamoDB to allow querying on GSI using IAM
    const messageTableServiceRole = new Role(this, 'MessageTableServiceRole', {
      assumedBy: new ServicePrincipal('dynamodb.amazonaws.com'),
    });

    messageTableServiceRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: [`${messageTable.tableArn}/index/message-by-room-id`],
        actions: ['dynamodb:Query'],
      })
    );
  }
}
