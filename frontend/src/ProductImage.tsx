import type { ImgHTMLAttributes } from 'react'
import { handleImageError, productImageUrl } from './product-image'

type ProductImageProps = Pick<ImgHTMLAttributes<HTMLImageElement>, 'alt' | 'className' | 'loading'> & {
  image: string
  width: number
  quality: number
}

export function ProductImage({ image, width, quality, ...imageProps }: ProductImageProps) {
  return (
    <img
      key={image}
      src={productImageUrl(image, width, quality)}
      {...imageProps}
      onError={handleImageError}
    />
  )
}
