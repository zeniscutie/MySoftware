import type { Metadata } from "next";
import { getProductsData } from "@/server/queries/products";
import { ProductsView } from "@/components/products/products-view";

export const metadata: Metadata = { title: "Products" };
export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const data = await getProductsData();
  return (
    <div className="@container">
      <ProductsView data={data} />
    </div>
  );
}
