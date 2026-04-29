import { betterAuth } from "better-auth";
import { pool } from '../db.js'
import { organization, admin } from "better-auth/plugins"

export const auth = betterAuth({
    database: pool,
    logger: { level: "debug" },
    trustedOrigins: (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://localhost:3001")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    emailAndPassword: { 
        enabled: true, 
    }, 
    plugins: [ 
        organization({
            schema: {
                organization: {
                    modelName: "organizations",
                    fields: {
                        id: "id",
                        name: "name",
                        slug: "slug",
                        logo: "logo",
                        createdAt: "created_at",
                        updatedAt: "updated_at",
                        metadata: "metadata",
                    }
                },
                member: {
                    modelName: "members",
                    fields: {
                        id: "id",
                        organizationId: "organization_id",
                        userId: "user_id",
                        role: "role",
                        createdAt: "created_at",
                        updatedAt: "updated_at",
                    }
                },
                invitation: {
                    modelName: "invitations",
                    fields: {
                        id: "id",
                        organizationId: "organization_id",
                        email: "email",
                        role: "role",
                        status: "status",
                        expiresAt: "expires_at",
                        inviterId: "inviter_id",
                        createdAt: "created_at",
                        updatedAt: "updated_at",
                    }
                },
            }
        }),
        admin() 
    ],
    advanced: {
        database: {
            useNumberId: true,
        },
    },
    user: {
        modelName: "users",
        fields: {
            id: "id",
            name: "name",
            email: "email",
            emailVerified: "email_verified",
            image: "image",
            role: "role",
            banned: "banned",
            banReason: "ban_reason",
            banExpires: "ban_expires",
            createdAt: "created_at",
            updatedAt: "updated_at"
        }
    },
    session: {
        modelName: "sessions",
        fields: {
            id: "id",
            expiresAt: "expires_at",
            token: "token",
            ipAddress: "ip_address",
            userAgent: "user_agent",
            userId: "user_id",
            createdAt: "created_at",
            updatedAt: "updated_at",
            activeOrganizationId: "active_organization_id",
            impersonatedBy: "impersonated_by",
        }
    },
    account: {
        modelName: "accounts",
        fields: {
            id: "id",
            accountId: "account_id",
            providerId: "provider_id",
            userId: "user_id",
            accessToken: "access_token",
            refreshToken: "refresh_token",
            idToken: "id_token",
            accessTokenExpiresAt: "access_token_expires_at",
            refreshTokenExpiresAt: "refresh_token_expires_at",
            scope: "scope",
            password: "password",
            createdAt: "created_at",
            updatedAt: "updated_at",
        }
    },
})
