from PIL import Image, ImageDraw
import os

os.chdir('icons')

# Create icons for different sizes
sizes = [16, 48, 128]
for size in sizes:
    # Create a new image with a nice blue color
    img = Image.new('RGBA', (size, size), (52, 152, 219, 255))
    draw = ImageDraw.Draw(img)
    
    # Draw a simple speaker/text icon
    margin = size // 8
    # Rectangle for text lines
    draw.rectangle([margin, margin, size-margin, margin+size//4], fill=(255, 255, 255, 200))
    draw.rectangle([margin, margin+size//3, size-margin, margin+size//2], fill=(255, 255, 255, 200))
    draw.rectangle([margin, margin+2*size//3, size-margin, size-margin], fill=(255, 255, 255, 200))
    
    img.save(f'icon{size}.png')
    print(f'Created icon{size}.png')
