import { PostConfirmationTriggerHandler } from 'aws-lambda'

/**
 * Cognito post-confirmation trigger.
 * Fires after a user confirms their account (admin-created users confirm on first login).
 * Use this to log new staff accounts to CloudWatch or sync to a staff table.
 */
export const handler: PostConfirmationTriggerHandler = async (event) => {
  const { email, sub } = event.request.userAttributes

  console.log(JSON.stringify({
    event: 'USER_CONFIRMED',
    userId: sub,
    email,
    userPoolId: event.userPoolId,
    timestamp: new Date().toISOString(),
  }))

  // TODO: If you add a Staff DynamoDB table, create the record here:
  // await ddb.send(new PutCommand({
  //   TableName: process.env.STAFF_TABLE!,
  //   Item: { PK: `STAFF#${sub}`, email, createdAt: new Date().toISOString() },
  // }))

  return event
}
