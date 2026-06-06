import { Router, Response, NextFunction } from "express";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import {
  getTenantProductFeatureAccess,
  listTenantProductAccess,
} from "../services/productAccess.service";

const router = Router();

// GET /api/v1/products/customer-access
// Public response wording uses Customer, while the DB remains tenantId-based.
router.get(
  "/customer-access",
  requireAuth,
  requireTenantScope,
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const [products, features] = await Promise.all([
        listTenantProductAccess(req.tenantId!),
        getTenantProductFeatureAccess(req.tenantId!),
      ]);

      res.json({
        success: true,
        data: {
          terminology: {
            public: "Customer",
            internal: "Tenant",
          },
          products: products.map((product) => ({
            key: product.key,
            name: product.name,
            category: product.category,
            description: product.description,
            routeHref: product.routeHref,
            featureKey: product.featureKey,
            icon: product.icon,
            enabled: product.enabled,
            limits: product.limits,
            source: product.source,
            disabledReason: product.disabledReason,
            addOns: product.addOns ?? [],
          })),
          productsByKey: Object.fromEntries(
            products.map((product) => [product.key, product.enabled]),
          ),
          features,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
