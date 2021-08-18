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

    // Define Graphql API
    const api = new GraphqlApi(this, 'reacltime-chat-app-api', {
      name: 'realtime-chat-app',
      logConfig: {
        fieldLogLevel: FieldLogLevel.ALL,
      },
      schema: Schema.fromAsset('graphql/schema.graphql'),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: AuthorizationType.USER_POOL,
          userPoolConfig: { userPool },
        },
      },
    });

    new cdk.CfnOutput(this, 'GraphQLAPIURL', {
      value: api.graphqlUrl,
    });

    // Add 2 tables resources
    const messageTableDs = api.addDynamoDbDataSource('Message', messageTable);
    const roomTableDs = api.addDynamoDbDataSource('Room', roomTable);

    // Resolvers Method
    messageTableDs.createResolver({
      typeName: 'Query',
      fieldName: 'listMessageForRoom',
      requestMappingTemplate: MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Query",
          "query": {
            "expression": "roomId = :roomId",
            "expressionValue": {
              ":roomId": $util.dynamodb.toDynamoDBJson($context.arguments.roomId)
            }
          }
          #if( !$util.isNull($ctx.arguments.sortDirection)
            && $ctx.arguments.sortDirection == "DESC" )
            ,"scanIndexForward": false
          #else
            ,"scanIndexForward": true
          #end
          #if($context.arguments.nextToken)
            ,"nextToken": "$context.arguments.nextToken"
          #end
        }
      `),
      responseMappingTemplate: MappingTemplate.fromString(`
        #if( $ctx.error )
          $util.error($ctx.error.message, $ctx.error.type)
        #else
          $util.toJson($ctx.result)
        #end
      `),
    });

    messageTableDs.createResolver({
      typeName: 'Mutation',
      fieldName: 'createMessage',
      requestMappingTemplate: MappingTemplate.fromString(`
        ## Automatically set the id if it's not passed in.
          $util.qr($context.args.input.put("id", $util.defaultIfNull($ctx.args.input.id, $util.autoId())))
        ## Automatically set the createdAt timestamp.
        #set( $createdAt = $util.time.nowISO8601() )
          util.qr($context.args.input.put("createdAt", $util.defaultIfNull($ctx.args.input.createdAt, $createdAt)))
        ## Automatically set the user's username on owner field.
          $util.qr($ctx.args.input.put("owner", $context.identity.username))
        ## Create a condition that will error if the id already exists
        #set( $condition = {
          "expression": "attribute_not_exists(#id)",
          "expressionNames": {
              "#id": "id"
          }
          } )
          {
            "version": "2018-05-29",
            "operation": "PutItem",
            "key": {
              "id":   $util.dynamodb.toDynamoDBJson($ctx.args.input.id)
            },
            "attributeValues": $util.dynamodb.toMapValuesJson($context.args.input),
            "condition": $util.toJson($condition)
          }
  `),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    });

    roomTableDs.createResolver({
      typeName: 'Query',
      fieldName: 'listRooms',
      requestMappingTemplate: MappingTemplate.fromString(`
        #set( $limit = $util.defaultIfNull($context.args.limit, 1000) )
        #set( $ListRequest = {
          "version": "2018-05-29",
          "limit": $limit
        } )
        #if( $context.args.nextToken )
          #set( $ListRequest.nextToken = $context.args.nextToken )
        #end
        $util.qr($ListRequest.put("operation", "Scan"))
        $util.toJson($ListRequest)
      `),
      responseMappingTemplate: MappingTemplate.fromString(`
        #if( $ctx.error)
          $util.error($ctx.error.message, $ctx.error.type)
        #else
          $util.toJson($ctx.result)
        #end
      `),
    });

    roomTableDs.createResolver({
      typeName: 'Mutation',
      fieldName: 'createRoom',
      requestMappingTemplate: MappingTemplate.fromString(`
  $util.qr($context.args.input.put("id", $util.defaultIfNull($ctx.args.input.id, $util.autoId())))
  {
    "version": "2018-05-29",
    "operation": "PutItem",
    "key": {
      "id":   $util.dynamodb.toDynamoDBJson($ctx.args.input.id)
    },
    "attributeValues": $util.dynamodb.toMapValuesJson($context.args.input),
    "condition": $util.toJson($condition)
  }
  `),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    });
  }
}
