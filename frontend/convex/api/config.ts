import { query } from "../_generated/server"
import { getUser } from "../model/auth"

export const getAppConfig = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx)
    return {
      user,
      authProviders: {
        google: !!(
          process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ),
        email: true,
      },
    }
  },
})
