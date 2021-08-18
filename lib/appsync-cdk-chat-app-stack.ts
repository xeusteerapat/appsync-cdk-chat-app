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
  }
}
