import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProductDetail } from "@/server/queries/products";
import { ProductDetailView } from "@/components/products/product-detail";

export const metadata: Metadata = { title: "Product" };
export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  if (!/^pr-\d{1,9}$/i.test(ref)) notFound();
  const d = await getProductDetail(ref);
  if (!d) notFound();
  return <ProductDetailView d={d} />;
}
